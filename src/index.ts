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
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
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

export const name = 'dsh-kanban'
export const inject = ['tools', 'webServer']

const STATUSES = ['todo', 'in_progress', 'done'] as const

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
    },
  },
  render: (_args: unknown, value: BoardView) => [
    {
      type: 'text' as const,
      text: [
        `Board at ${value.path}`,
        ...value.cards.map(card =>
          `- [${card.status}] ${card.title}${card.tags.length > 0 ? ` ${card.tags.map(t => `#${t}`).join(' ')}` : ''}`),
        ...value.cards.length === 0 ? ['(no cards yet)'] : [],
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

/** Register the four model-facing board tools. */
export function apply(ctx: Context): void {
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
        cards: board.cards,
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
      + 'survives session switches and shows up on the Web board page. The board lives at KANBAN.json in the workspace root.',
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
        ...args.status === undefined ? {} : { status: args.status as BoardStatus },
        ...args.tags === undefined ? {} : { tags: args.tags },
      }).then(view => view)
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
      tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags.' },
    },
    output: BOARD_OUTPUT,
    execute(args, exec) {
      const cwd = workspaceOf(exec.agent?.session.header.cwd)
      const patch: {
        title?: string
        description?: string
        status?: BoardStatus
        tags?: string[]
      } = {}
      if (args.status !== undefined) patch.status = args.status as BoardStatus
      if (args.title !== undefined) patch.title = args.title
      if (args.description !== undefined) patch.description = args.description
      if (args.tags !== undefined) patch.tags = args.tags
      return updateCard(cwd, args.id, patch).then(view => view)
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
      return removeCard(cwd, args.id).then(view => view)
    },
    presentCall: args => present('Remove kanban card', 'other', (args as { id: string }).id),
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
  status?: BoardStatus
  tags?: string[]
}): Promise<BoardView> {
  switch (body.op) {
    case 'add':
      return await addCard(cwd, {
        title: body.title ?? '',
        ...body.description === undefined ? {} : { description: body.description },
        ...body.status === undefined ? {} : { status: body.status },
        ...body.tags === undefined ? {} : { tags: body.tags },
      })
    case 'update': {
      if (body.id === undefined) throw new TypeError('kanban: update requires id')
      const patch: { title?: string; description?: string; status?: BoardStatus; tags?: string[] } = {}
      if (body.title !== undefined) patch.title = body.title
      if (body.description !== undefined) patch.description = body.description
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
