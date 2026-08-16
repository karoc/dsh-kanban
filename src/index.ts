/**
 * dsh-kanban host half: model-facing board tools plus the webServer route that
 * backs the Web board page.
 *
 * The board is workspace-scoped: the KANBAN.json file lives at the session
 * workspace root (the `cwd` of the calling agent, or the `cwd` query param the
 * Web page sends). This is what makes it cross-session, cross-branch, and
 * git-trackable.
 *
 * Tools:
 *   board_list   — read the current workspace board
 *   board_add    — add a card
 *   board_update — change a card (status/title/description/tags)
 *   board_remove — delete a card
 *
 * Web route:
 *   GET  /kanban/api?cwd=<abs path>   → { path, cards, counts }
 *   POST /kanban/api                  → body { cwd, op, ... } → the fresh view
 *
 * The Web page and the model tools share one domain (`./board-core.ts`), so
 * whatever the model writes the page sees, and vice versa.
 *
 * To make the model actually USE the board, this host half also:
 *   - registers a system-prompt guidance section telling it when to record,
 *     move, and close cards (and how this differs from todo_write);
 *   - registers a `/kanban` command for the human to view/maintain the board.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import {
  addCard,
  readBoard,
  removeCard,
  updateCard,
  type BoardStatus,
  type BoardView,
} from './board-core.ts'
import {
  DEFAULT_NON_TRIVIAL_DEFINITION,
  DEFAULT_NOTE_CLASSES,
  DEFAULT_NOTE_FORMAT,
  NOTE_SPEC_VERSION,
  effectiveNoteSpec,
  noteOverridesPath,
  writeNoteOverrides,
  type EffectiveNoteSpec,
  type NoteSpecOverrides,
} from './note-spec.ts'

export const name = 'dsh-kanban'
export const inject = ['tools', 'webServer', 'systemPrompt', 'commands']

const STATUSES = ['todo', 'in_progress', 'done'] as const

/** One card as returned by a tool (matches the output schema exactly). */
export interface BoardToolCard {
  id: string
  title: string
  description?: string
  summary?: string
  rationale?: string
  rejected?: string
  sourceSessionId?: string
  status: 'todo' | 'in_progress' | 'done'
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** The canonical tool output: the full fresh board view (mutable cards). */
export interface BoardToolValue {
  path: string
  cards: BoardToolCard[]
  counts: { todo: number; inProgress: number; done: number }
  archived?: { count: number; path: string }
}

/** Build a {@link BoardToolValue} from a {@link BoardView}. */
function toBoardValue(view: BoardView): BoardToolValue {
  return {
    path: view.path,
    cards: view.cards.map(card => ({
      id: card.id,
      title: card.title,
      ...card.description === undefined ? {} : { description: card.description },
      ...card.summary === undefined ? {} : { summary: card.summary },
      ...card.rationale === undefined ? {} : { rationale: card.rationale },
      ...card.rejected === undefined ? {} : { rejected: card.rejected },
      ...card.sourceSessionId === undefined ? {} : { sourceSessionId: card.sourceSessionId },
      status: card.status,
      tags: card.tags,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    })),
    counts: view.counts,
    ...view.archived !== undefined ? { archived: view.archived } : {},
  }
}

/** Canonical board output shared by every tool: the full fresh board view. */
const BOARD_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', required: true },
      cards: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            title: { type: 'string', required: true },
            description: { type: 'string' },
            summary: { type: 'string' },
            rationale: { type: 'string' },
            rejected: { type: 'string' },
            sourceSessionId: { type: 'string' },
            status: { type: 'string', required: true, enum: ['todo', 'in_progress', 'done'] },
            tags: { type: 'array', required: true, items: { type: 'string' } },
            createdAt: { type: 'integer', required: true },
            updatedAt: { type: 'integer', required: true },
          },
        },
      },
      counts: {
        type: 'object',
        additionalProperties: false,
        required: true,
        properties: {
          todo: { type: 'integer', required: true },
          inProgress: { type: 'integer', required: true },
          done: { type: 'integer', required: true },
        },
      },
      archived: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          path: { type: 'string', required: true },
        },
      },
    },
  } as const,
  render: (_args: unknown, value: BoardToolValue) => [
    {
      type: 'text' as const,
      text: [
        `Board at ${value.path}`,
        ...value.cards.map(card =>
          `- [${card.status}] ${card.title}${card.tags.length > 0 ? ` ${card.tags.map(t => `#${t}`).join(' ')}` : ''}`),
        ...value.cards.length === 0 ? ['(no cards yet)'] : [],
        ...value.archived !== undefined
          ? [`Archived ${value.archived.count} done card(s) to ${value.archived.path}`]
          : [],
      ].join('\n'),
    },
  ],
}

/** Resolve the workspace root for a tool call: the owning session's cwd. */
function workspaceOf(cwd: string | undefined): string {
  if (cwd === undefined || cwd === '') {
    throw new Error('kanban: no workspace — this call has no owning session cwd')
  }
  return cwd
}

function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/**
 * The system-prompt guidance that tells the model to actually USE the board
 * and to keep Agent Notes for non-trivial changes. This is what makes it an
 * active maintenance habit instead of a passive tool: record plans as they
 * appear, move cards as work progresses, close them when done — across
 * sessions — and write a durable decision note for every non-trivial change.
 */
const BOARD_GUIDANCE = 'You have a persistent kanban board (the board_* tools) backed by '
  + 'KANBAN.json at the workspace root — it survives session switches and branches, and it '
  + 'is shared with the Web "看板" page. Use it to track plans and todos that should outlive '
  + 'the current turn: when the user states a multi-step plan or a list of tasks, record each '
  + 'step with board_add (title; status todo; tags for grouping). As work progresses, move '
  + 'cards with board_update (status in_progress → done); when a card is finished or '
  + 'superseded, mark it done or remove it. Prefer the board over todo_write for anything the '
  + 'user should still see after switching branches or opening a new session: todo_write is '
  + 'the transient in-turn task list, while the board is the durable cross-session record. '
  + 'Check board_list when resuming work in a workspace to pick up what was planned before.\n\n'
  + 'You also maintain Agent Notes (the note_add / note_list tools) at '
  + '.agents/notes/implemented/<class>/<date>-<topic>.md, mirroring the DeepSeek Harness '
  + `repository discipline. ${DEFAULT_NON_TRIVIAL_DEFINITION} `
  + 'After completing a non-trivial change, call note_add with: a class from '
  + `{${DEFAULT_NOTE_CLASSES.join(', ')}}; a short kebab-case `
  + 'topic; the problem being solved; the decision made; what alternatives were rejected and '
  + 'why; and consequences. Keep it a few paragraphs, not a full essay.'

/** Execute the human `/kanban` command against the receiving agent's workspace. */
async function executeBoardCommand(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const agent = invocation.agent
  const cwd = agent?.session.header.cwd
  if (cwd === undefined || cwd === '') {
    return { kind: 'error', text: 'kanban: no workspace — this session has no cwd' }
  }
  const input = invocation.rawInput.trim()
  const done = async (id: string): Promise<CommandResult> => {
    try {
      const view = await updateCard(cwd, id, { status: 'done' })
      return renderBoardResult('Marked done.', view)
    } catch (error) {
      return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
    }
  }
  const run = async (): Promise<CommandResult> => {
    if (input === '' || input === 'list') {
      try {
        const board = await readBoard(cwd)
        return renderBoardResult(undefined, {
          path: `${cwd}/KANBAN.json`,
          cards: board.cards,
          counts: {
            todo: board.cards.filter(c => c.status === 'todo').length,
            inProgress: board.cards.filter(c => c.status === 'in_progress').length,
            done: board.cards.filter(c => c.status === 'done').length,
          },
        })
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    }
    if (input.startsWith('done ')) {
      const id = input.slice(5).trim()
      if (id === '') return { kind: 'error', text: 'Usage: /kanban done <card-id>' }
      return await done(id)
    }
    return { kind: 'error', text: 'Usage: /kanban [list|done <card-id>]' }
  }
  return run()
}

/** Render a board document as a `/kanban` command result. */
function renderBoardResult(heading: string | undefined, view: BoardView): CommandResult {
  const lines = [
    ...heading !== undefined ? [heading] : [],
    `Board at ${view.path}`,
    ...view.cards.map(card =>
      `- [${card.status}] ${card.title}${card.tags.length > 0 ? ` ${card.tags.map(t => `#${t}`).join(' ')}` : ''}`),
    ...view.cards.length === 0 ? ['(no cards yet)'] : [],
  ]
  return { kind: 'success', text: lines.join('\n') }
}

/** Register the `/kanban` command (view + quick done). */
function registerBoardCommand(ctx: Context): void {
  ctx.commands.register({
    name: 'kanban',
    description: 'view or update the workspace kanban board',
    input: { hint: '[list|done <card-id>]' },
    handler: invocation => executeBoardCommand(ctx, invocation),
  })
}

// ── Agent Notes (complete replication of the DSH repository discipline) ────

/**
 * The default closed set of Agent Note classes (mirrors DSH's classification
 * gate). The tool schema advertises the defaults; at execution time the
 * workspace's effective spec (defaults + user overrides) is authoritative.
 */
export const NOTE_CLASSES = DEFAULT_NOTE_CLASSES
export type NoteClass = (typeof NOTE_CLASSES)[number]

/** Canonical note file name: <yyyy-mm-dd>-<kebab-topic>.md */
function noteFileName(topic: string): string {
  const kebab = topic.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const today = new Date().toISOString().slice(0, 10)
  return `${today}-${kebab === '' ? 'note' : kebab}.md`
}

/** Resolve a note path under the workspace. */
function notePath(cwd: string, noteClass: NoteClass, topic: string): string {
  if (!isAbsolute(cwd)) throw new TypeError(`kanban: workspace must be an absolute path, got ${JSON.stringify(cwd)}`)
  return join(cwd, '.agents', 'notes', 'implemented', noteClass, noteFileName(topic))
}

/** Render the note body template with the note's fields. */
function renderNoteBody(spec: EffectiveNoteSpec, title: string, body: {
  problem: string
  decision: string
  alternatives?: string
  consequences?: string
}): string {
  const alternatives = body.alternatives?.trim() ?? ''
  const consequences = body.consequences?.trim() ?? ''
  const alternativesSection = alternatives === ''
    ? ''
    : `## Alternatives considered\n\n${alternatives}`
  const consequencesSection = consequences === ''
    ? ''
    : `## Consequences\n\n${consequences}`
  return spec.noteFormat
    .replaceAll('{{title}}', title)
    .replaceAll('{{problem}}', body.problem.trim())
    .replaceAll('{{decision}}', body.decision.trim())
    .replaceAll('{{alternatives}}', alternatives)
    .replaceAll('{{consequences}}', consequences)
    .replaceAll('{{alternatives_section}}', alternativesSection)
    .replaceAll('{{consequences_section}}', consequencesSection)
}

/** Write one Agent Note file using the workspace's effective spec. */
async function writeAgentNote(cwd: string, noteClass: NoteClass, topic: string, body: {
  problem: string
  decision: string
  alternatives?: string
  consequences?: string
}): Promise<string> {
  const spec = await effectiveNoteSpec(cwd)
  if (noteClass !== undefined && !spec.noteClasses.includes(noteClass)) {
    throw new TypeError(`kanban: note class ${JSON.stringify(noteClass)} is not in the effective note classes (${spec.noteClasses.join(', ')})`)
  }
  const path = notePath(cwd, noteClass, topic)
  const title = topic.trim()
  if (title === '') throw new TypeError('kanban: note topic must be a non-empty string')
  if (body.problem.trim() === '' || body.decision.trim() === '') {
    throw new TypeError('kanban: note requires a problem and a decision')
  }
  const content = renderNoteBody(spec, title, body) + '\n'
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content, 'utf8')
  return path
}

/** Canonical note tool output. */
export interface NoteToolValue {
  path: string
  noteClass: NoteClass
  topic: string
}

const NOTE_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', required: true },
      noteClass: { type: 'string', required: true, enum: NOTE_CLASSES },
      topic: { type: 'string', required: true },
    },
  } as const,
  render: (_args: unknown, value: NoteToolValue) => [
    { type: 'text' as const, text: `Agent Note written to ${value.path}` },
  ],
}

/** List existing Agent Notes under the workspace, grouped by class. */
async function listAgentNotes(cwd: string): Promise<string[]> {
  if (!isAbsolute(cwd)) throw new TypeError(`kanban: workspace must be an absolute path, got ${JSON.stringify(cwd)}`)
  const root = join(cwd, '.agents', 'notes', 'implemented')
  const found: string[] = []
  for (const noteClass of NOTE_CLASSES) {
    try {
      const entries = await readdir(join(root, noteClass))
      for (const entry of entries) {
        if (entry.endsWith('.md')) found.push(join(root, noteClass, entry))
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return found.sort()
}

/** Register the four model-facing board tools. */
export function apply(ctx: Context): void {
  // Tell the model when/why to use the board (tool-guidance range 100-199).
  ctx.systemPrompt.section({
    name: 'tool:board',
    order: 113,
    text: BOARD_GUIDANCE,
  })
  // Human-facing `/kanban` command.
  registerBoardCommand(ctx)

  ctx.tools.register(defineTool({
    name: 'board_list',
    description: 'Read the current workspace kanban board (all cards with their status, tags, and timestamps). '
      + 'Call this before board_add / board_update / board_remove so you operate on real ids and current state. '
      + 'The board is persisted to KANBAN.json at the workspace root and survives across sessions and branches.',
    parameters: {},
    output: BOARD_OUTPUT,
    execute(_args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      return readBoard(cwd).then(board => ({
        path: `${cwd}/KANBAN.json`,
        cards: board.cards.map(card => ({
          id: card.id,
          title: card.title,
          ...card.description === undefined ? {} : { description: card.description },
          ...card.summary === undefined ? {} : { summary: card.summary },
          ...card.rationale === undefined ? {} : { rationale: card.rationale },
          ...card.rejected === undefined ? {} : { rejected: card.rejected },
          ...card.sourceSessionId === undefined ? {} : { sourceSessionId: card.sourceSessionId },
          status: card.status,
          tags: card.tags,
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
        })),
        counts: {
          todo: board.cards.filter(c => c.status === 'todo').length,
          inProgress: board.cards.filter(c => c.status === 'in_progress').length,
          done: board.cards.filter(c => c.status === 'done').length,
        },
      }))
    },
    presentCall: () => present('Read kanban board', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'board_add',
    description: 'Add a card to the current workspace kanban board. Use it to persist a plan step or todo so it '
      + 'survives session switches and shows up on the Web board page. When the user states a multi-step plan or a '
      + 'list of tasks, record each concrete step here. The board lives at KANBAN.json in the workspace root.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Non-empty card title (a concrete, actionable step).',
      },
      description: {
        type: 'string',
        description: 'Optional free-form detail for the card.',
      },
      summary: {
        type: 'string',
        description: 'Optional: what was done (Agent-Note style).',
      },
      rationale: {
        type: 'string',
        description: 'Optional: why it was done (Agent-Note style).',
      },
      rejected: {
        type: 'string',
        description: 'Optional: what was rejected or given up (Agent-Note style).',
      },
      status: {
        type: 'string',
        enum: STATUSES,
        description: 'Initial status; defaults to todo.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional labels (e.g. ["dsh", "urgent"]).',
      },
    },
    output: BOARD_OUTPUT,
    execute(args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      return addCard(cwd, {
        title: args.title,
        ...args.description === undefined ? {} : { description: args.description },
        ...args.summary === undefined ? {} : { summary: args.summary },
        ...args.rationale === undefined ? {} : { rationale: args.rationale },
        ...args.rejected === undefined ? {} : { rejected: args.rejected },
        ...exec.agent !== undefined ? { sourceSessionId: exec.agent.id } : {},
        ...args.status === undefined ? {} : { status: args.status as BoardStatus },
        ...args.tags === undefined ? {} : { tags: args.tags },
      }).then(toBoardValue)
    },
    presentCall: args => present('Add kanban card', 'other', (args as { title: string }).title),
  }))

  ctx.tools.register(defineTool({
    name: 'board_update',
    description: 'Update one card on the current workspace kanban board by its exact id. '
      + 'Use it to move a card between todo / in_progress / done, or to edit its title, description, or tags. '
      + 'Call board_list first to get the id.',
    parameters: {
      id: {
        type: 'string',
        required: true,
        description: 'Exact card id returned by board_list.',
      },
      status: {
        type: 'string',
        enum: STATUSES,
        description: 'New status: todo | in_progress | done.',
      },
      title: { type: 'string', description: 'Replacement title.' },
      description: { type: 'string', description: 'Replacement description; empty string clears it.' },
      summary: { type: 'string', description: 'Replacement "what was done"; empty string clears it.' },
      rationale: { type: 'string', description: 'Replacement "why it was done"; empty string clears it.' },
      rejected: { type: 'string', description: 'Replacement "what was rejected"; empty string clears it.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags.' },
    },
    output: BOARD_OUTPUT,
    execute(args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      const patch: {
        title?: string
        description?: string
        summary?: string
        rationale?: string
        rejected?: string
        status?: BoardStatus
        tags?: string[]
      } = {}
      if (args.status !== undefined) patch.status = args.status as BoardStatus
      if (args.title !== undefined) patch.title = args.title
      if (args.description !== undefined) patch.description = args.description
      if (args.summary !== undefined) patch.summary = args.summary
      if (args.rationale !== undefined) patch.rationale = args.rationale
      if (args.rejected !== undefined) patch.rejected = args.rejected
      if (args.tags !== undefined) patch.tags = args.tags
      return updateCard(cwd, args.id, patch).then(toBoardValue)
    },
    presentCall: args => present(
      'Update kanban card',
      'other',
      (args as { id: string; status?: string }).status
        ? `${(args as { id: string }).id} → ${(args as { status: string }).status}`
        : (args as { id: string }).id,
    ),
  }))

  ctx.tools.register(defineTool({
    name: 'board_remove',
    description: 'Remove one card from the current workspace kanban board by its exact id. '
      + 'Call board_list first to get the id.',
    parameters: {
      id: { type: 'string', required: true, description: 'Exact card id returned by board_list.' },
    },
    output: BOARD_OUTPUT,
    execute(args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      return removeCard(cwd, args.id).then(toBoardValue)
    },
    presentCall: args => present('Remove kanban card', 'other', (args as { id: string }).id),
  }))

  // Agent Notes: complete replication of the DSH repository discipline.
  ctx.tools.register(defineTool({
    name: 'note_add',
    description: 'Write an Agent Note documenting a NON-TRIVIAL change, at '
      + '.agents/notes/implemented/<class>/<date>-<topic>.md (mirrors the DeepSeek Harness '
      + 'repository discipline). A change is non-trivial when it changes behavior, '
      + 'architecture, cross-file/cross-package conventions, process or tooling, test '
      + 'strategy, storage/wire/config format, or makes a decision a maintainer could '
      + 'reasonably revisit. Call this AFTER completing such a change, alongside any board '
      + 'cards — the note records the why and what was rejected that the code cannot.',
    parameters: {
      class: {
        type: 'string',
        required: true,
        enum: NOTE_CLASSES,
        description: 'Note class: feature | bug-fix | simplification | architecture | process | testing.',
      },
      topic: {
        type: 'string',
        required: true,
        description: 'Short kebab-case topic (e.g. "web-kanban-plugin").',
      },
      problem: {
        type: 'string',
        required: true,
        description: 'The problem being solved (one short paragraph).',
      },
      decision: {
        type: 'string',
        required: true,
        description: 'The decision made (what was done and why; a few paragraphs).',
      },
      alternatives: {
        type: 'string',
        description: 'Optional: what alternatives were rejected and why.',
      },
      consequences: {
        type: 'string',
        description: 'Optional: consequences and effects of the decision.',
      },
    },
    output: NOTE_OUTPUT,
    execute(args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      return writeAgentNote(cwd, args.class, args.topic, {
        problem: args.problem,
        decision: args.decision,
        ...args.alternatives === undefined ? {} : { alternatives: args.alternatives },
        ...args.consequences === undefined ? {} : { consequences: args.consequences },
      }).then(path => ({ path, noteClass: args.class, topic: args.topic }))
    },
    presentCall: args => present('Write Agent Note', 'other', (args as { topic: string }).topic),
  }))

  ctx.tools.register(defineTool({
    name: 'note_list',
    description: 'List existing Agent Notes under the current workspace (.agents/notes/implemented/**). '
      + 'Use it before note_add to avoid duplicating a note that already covers the decision.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          notes: { type: 'array', required: true, items: { type: 'string' } },
        },
      } as const,
      render: (_args: unknown, value: { notes: string[] }) => [
        {
          type: 'text' as const,
          text: value.notes.length === 0
            ? 'No Agent Notes yet.'
            : ['Agent Notes:', ...value.notes].join('\n'),
        },
      ],
    },
    execute(_args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      return listAgentNotes(cwd).then(notes => ({ notes }))
    },
    presentCall: () => present('List Agent Notes', 'read'),
  }))

  registerWebApi(ctx)
}

// ── Web API route (the board page's read/write channel) ────────────────────

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** Write a JSON body with a status code. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(value))
}

/** Collect a request body (bounded). */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('kanban: request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Shared POST mutation dispatch; every op returns the fresh board view. */
async function applyMutation(cwd: string, body: {
  op?: string
  id?: string
  title?: string
  description?: string
  summary?: string
  rationale?: string
  rejected?: string
  status?: BoardStatus
  tags?: string[]
}): Promise<BoardView> {
  switch (body.op) {
    case 'add':
      return await addCard(cwd, {
        title: body.title ?? '',
        ...body.description === undefined ? {} : { description: body.description },
        ...body.summary === undefined ? {} : { summary: body.summary },
        ...body.rationale === undefined ? {} : { rationale: body.rationale },
        ...body.rejected === undefined ? {} : { rejected: body.rejected },
        ...body.status === undefined ? {} : { status: body.status },
        ...body.tags === undefined ? {} : { tags: body.tags },
      })
    case 'update': {
      if (body.id === undefined) throw new TypeError('kanban: update requires id')
      const patch: {
        title?: string
        description?: string
        summary?: string
        rationale?: string
        rejected?: string
        status?: BoardStatus
        tags?: string[]
      } = {}
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) patch.description = body.description
      if (body.summary !== undefined) patch.summary = body.summary
      if (body.rationale !== undefined) patch.rationale = body.rationale
      if (body.rejected !== undefined) patch.rejected = body.rejected
      if (body.status !== undefined) patch.status = body.status
      if (body.tags !== undefined) patch.tags = body.tags
      return await updateCard(cwd, body.id, patch)
    }
    case 'remove':
      if (body.id === undefined) throw new TypeError('kanban: remove requires id')
      return await removeCard(cwd, body.id)
    default:
      throw new TypeError(`kanban: unknown op ${JSON.stringify(body.op)}`)
  }
}

/** Build the fresh board view for a workspace (the route's read path). */
async function viewOf(cwd: string): Promise<BoardView> {
  const board = await readBoard(cwd)
  return {
    path: `${cwd}/KANBAN.json`,
    cards: board.cards,
    counts: {
      todo: board.cards.filter(c => c.status === 'todo').length,
      inProgress: board.cards.filter(c => c.status === 'in_progress').length,
      done: board.cards.filter(c => c.status === 'done').length,
    },
  }
}

/** Register GET/POST /kanban/api — the Web board page's data channel. */
function registerWebApi(ctx: Context): void {
  const server = ctx.get('webServer') as
    | { register: (route: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => void }
    | undefined
  if (server === undefined) return

  server.register({
    kind: 'prefix',
    path: '/kanban/api',
    handler: (req, res) => {
      void handle(req, res).catch(error => {
        if (!res.writableEnded) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
  })

  // Spec read/write: the Web page's "Agent Note spec" settings inputs.
  server.register({
    kind: 'prefix',
    path: '/kanban/spec',
    handler: (req, res) => {
      void handleSpec(req, res).catch(error => {
        if (!res.writableEnded) {
          sendJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    },
  })

  async function handleSpec(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET'
    if (method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const cwd = url.searchParams.get('cwd')
      if (cwd === null || cwd === '') {
        sendJson(res, 400, { ok: false, error: 'kanban: GET /kanban/spec requires a cwd query parameter' })
        return
      }
      const spec = await effectiveNoteSpec(cwd)
      sendJson(res, 200, {
        ok: true,
        specVersion: spec.specVersion,
        pluginSpecVersion: NOTE_SPEC_VERSION,
        noteClasses: spec.noteClasses,
        noteFormat: spec.noteFormat,
        nonTrivialDefinition: spec.nonTrivialDefinition,
        hasOverrides: spec.hasOverrides,
        overridesPath: noteOverridesPath(cwd),
      })
      return
    }
    if (method === 'POST') {
      const raw = await readBody(req)
      let body: {
        cwd?: string
        noteClasses?: string[]
        noteFormat?: string
        nonTrivialDefinition?: string
        acknowledgeSpecVersion?: number
      }
      try {
        body = JSON.parse(raw) as typeof body
      } catch (error) {
        sendJson(res, 400, { ok: false, error: `kanban: invalid JSON body: ${(error as Error).message}` })
        return
      }
      if (typeof body.cwd !== 'string' || body.cwd === '') {
        sendJson(res, 400, { ok: false, error: 'kanban: POST /kanban/spec requires body.cwd' })
        return
      }
      const overrides: NoteSpecOverrides = {
        ...body.noteClasses !== undefined ? { noteClasses: body.noteClasses } : {},
        ...body.noteFormat !== undefined ? { noteFormat: body.noteFormat } : {},
        ...body.nonTrivialDefinition !== undefined ? { nonTrivialDefinition: body.nonTrivialDefinition } : {},
        ...body.acknowledgeSpecVersion !== undefined ? { specVersion: body.acknowledgeSpecVersion } : {},
      }
      await writeNoteOverrides(body.cwd, overrides)
      const spec = await effectiveNoteSpec(body.cwd)
      sendJson(res, 200, {
        ok: true,
        specVersion: spec.specVersion,
        pluginSpecVersion: NOTE_SPEC_VERSION,
        noteClasses: spec.noteClasses,
        noteFormat: spec.noteFormat,
        nonTrivialDefinition: spec.nonTrivialDefinition,
        hasOverrides: spec.hasOverrides,
        overridesPath: noteOverridesPath(body.cwd),
      })
      return
    }
    sendJson(res, 405, { ok: false, error: `kanban: method ${method} not allowed` })
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET'
    if (method === 'GET') {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const cwd = url.searchParams.get('cwd')
      if (cwd === null || cwd === '') {
        sendJson(res, 400, { ok: false, error: 'kanban: GET /kanban/api requires a cwd query parameter' })
        return
      }
      sendJson(res, 200, { ok: true, ...await viewOf(cwd) })
      return
    }
    if (method === 'POST') {
      const raw = await readBody(req)
      let body: {
        cwd?: string
        op?: string
        id?: string
        title?: string
        description?: string
        summary?: string
        rationale?: string
        rejected?: string
        status?: BoardStatus
        tags?: string[]
      }
      try {
        body = JSON.parse(raw) as typeof body
      } catch (error) {
        sendJson(res, 400, { ok: false, error: `kanban: invalid JSON body: ${(error as Error).message}` })
        return
      }
      if (typeof body.cwd !== 'string' || body.cwd === '') {
        sendJson(res, 400, { ok: false, error: 'kanban: POST /kanban/api requires body.cwd' })
        return
      }
      try {
        const view = await applyMutation(body.cwd, body)
        sendJson(res, 200, { ok: true, ...view })
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    sendJson(res, 405, { ok: false, error: `kanban: method ${method} not allowed` })
  }
}
