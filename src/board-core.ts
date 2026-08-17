/**
 * Core kanban domain: a workspace-scoped KANBAN.json file with card CRUD.
 *
 * Shared by the model-facing tools (src/index.ts) and the webServer route that
 * backs the Web board page (also src/index.ts). The file lives at the workspace
 * root so it is git-trackable, human-editable, and survives session switches.
 *
 * The board shape is deliberately minimal: one flat card list with a three-state
 * status. No columns to configure, no per-card nesting — the workspace owns one
 * board, and a "plan" is expressed as a tag or a group of cards.
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

/** The single git-trackable board filename at the workspace root. */
export const KANBAN_FILE = 'KANBAN.json'

/** The three lifecycle states of a board card. */
export type BoardStatus = 'todo' | 'in_progress' | 'done'

export const BOARD_STATUSES: readonly BoardStatus[] = ['todo', 'in_progress', 'done']

/** One kanban card. */
export interface BoardCard {
  /** Stable identity (a random uuid); never changes across updates. */
  id: string
  /** Non-empty trimmed title. */
  title: string
  /** Optional free-form detail. */
  description?: string
  /** Optional: what was done (Agent-Note-style "what"). */
  summary?: string
  /** Optional: why it was done (Agent-Note-style "why"). */
  rationale?: string
  /** Optional: what was rejected / given up (Agent-Note-style "rejected"). */
  rejected?: string
  /** Optional: the session id that created this card (locate the handling session). */
  sourceSessionId?: string
  /** Lifecycle state; drives the board columns. */
  status: BoardStatus
  /** Free-form labels (trimmed, deduped). */
  tags: string[]
  /** Epoch milliseconds of creation. */
  createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  updatedAt: number
}

/** The durable KANBAN.json document. */
export interface BoardData {
  /** Document format version (currently 1). */
  version: 1
  /** All cards, in insertion order. */
  cards: BoardCard[]
}

/** The resolved board file path for one workspace. */
export function boardPath(cwd: string): string {
  if (!isAbsolute(cwd)) throw new TypeError(`kanban: workspace must be an absolute path, got ${JSON.stringify(cwd)}`)
  return join(cwd, KANBAN_FILE)
}

/** Empty board document. */
export function emptyBoard(): BoardData {
  return { version: 1, cards: [] }
}

/** Whether a parsed KANBAN.json value is structurally a {@link BoardData}. */
export function isBoardData(value: unknown): value is BoardData {
  if (typeof value !== 'object' || value === null) return false
  const board = value as Partial<BoardData>
  if (board.version !== 1 || !Array.isArray(board.cards)) return false
  return board.cards.every(isBoardCard)
}

/** Whether a parsed value is structurally a {@link BoardCard}. */
export function isBoardCard(value: unknown): value is BoardCard {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Partial<BoardCard>
  if (typeof card.id !== 'string' || card.id === '') return false
  if (typeof card.title !== 'string' || card.title.trim() === '') return false
  if (!BOARD_STATUSES.includes(card.status as BoardStatus)) return false
  if (!Array.isArray(card.tags) || !card.tags.every(tag => typeof tag === 'string')) return false
  if (typeof card.createdAt !== 'number' || typeof card.updatedAt !== 'number') return false
  if (card.description !== undefined && typeof card.description !== 'string') return false
  if (card.summary !== undefined && typeof card.summary !== 'string') return false
  if (card.rationale !== undefined && typeof card.rationale !== 'string') return false
  if (card.rejected !== undefined && typeof card.rejected !== 'string') return false
  return card.sourceSessionId === undefined || typeof card.sourceSessionId === 'string'
}

/**
 * Read the board document for one workspace. A missing file yields the empty
 * board; a structurally invalid document throws (never silently repaired, so a
 * hand-edited KANBAN.json that breaks shape fails loud instead of losing data).
 * @param cwd - absolute workspace root.
 * @returns the parsed board document.
 */
export async function readBoard(cwd: string): Promise<BoardData> {
  const path = boardPath(cwd)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyBoard()
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`kanban: ${path} is not valid JSON: ${(error as Error).message}`)
  }
  if (!isBoardData(parsed)) {
    throw new Error(`kanban: ${path} does not match the KANBAN.json shape (expected { version: 1, cards: [...] })`)
  }
  return parsed
}

/**
 * Synchronous read for prompt-assembly-time use (systemPrompt.context text is
 * a sync `(context) => string`). Same semantics as {@link readBoard}: a missing
 * file yields the empty board; a structurally invalid document throws.
 * @param cwd - absolute workspace root.
 * @returns the parsed board document.
 */
export function readBoardSync(cwd: string): BoardData {
  const path = boardPath(cwd)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyBoard()
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`kanban: ${path} is not valid JSON: ${(error as Error).message}`)
  }
  if (!isBoardData(parsed)) {
    throw new Error(`kanban: ${path} does not match the KANBAN.json shape (expected { version: 1, cards: [...] })`)
  }
  return parsed
}

/** Atomically write the board document (tmp + rename). */
async function writeBoard(cwd: string, board: BoardData): Promise<void> {
  const path = boardPath(cwd)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify(board, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}

/** Max done cards kept on the board; older done cards are archived. */
export const MAX_DONE_CARDS = 100

/** The archive document path under .agents/notes (git-trackable). */
export function archivePath(cwd: string): string {
  if (!isAbsolute(cwd)) throw new TypeError(`kanban: workspace must be an absolute path, got ${JSON.stringify(cwd)}`)
  return join(cwd, '.agents', 'notes', 'archive.json')
}

/**
 * Archive done cards beyond {@link MAX_DONE_CARDS}: the oldest done cards
 * (by createdAt) are appended to `.agents/notes/archive.json` and removed from
 * the live board. Returns how many were archived (0 when none). Callers must
 * write the (mutated) board after this.
 */
export async function archiveExcessDone(cwd: string, board: BoardData): Promise<{ count: number; path: string }> {
  const done = board.cards.filter(card => card.status === 'done')
  if (done.length <= MAX_DONE_CARDS) return { count: 0, path: archivePath(cwd) }
  const excess = done.length - MAX_DONE_CARDS
  const byAge = [...done].sort((a, b) => a.createdAt - b.createdAt)
  const toArchive = byAge.slice(0, excess)
  const ids = new Set(toArchive.map(card => card.id))
  board.cards = board.cards.filter(card => !ids.has(card.id))
  const path = archivePath(cwd)
  await mkdir(dirname(path), { recursive: true })
  let existing: BoardCard[] = []
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw) as { version?: number; archived?: BoardCard[] }
    if (Array.isArray(parsed.archived)) existing = parsed.archived
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  existing.push(...toArchive)
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, archived: existing }, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
  return { count: toArchive.length, path }
}

/** Board counts by status (the UI's column headers). */
export interface BoardCounts {
  todo: number
  inProgress: number
  done: number
}

/** A read-only view of one board for consumers. */
export interface BoardView {
  /** Absolute path of the KANBAN.json document. */
  path: string
  /** All cards, insertion order. */
  cards: readonly BoardCard[]
  /** Status counts. */
  counts: BoardCounts
  /** Archival notice for the most recent mutation (count > 0 when archived). */
  archived?: { count: number; path: string }
}

/** Build a detached {@link BoardView} from a document. */
function viewOf(cwd: string, board: BoardData, archived?: { count: number; path: string }): BoardView {
  const counts: BoardCounts = { todo: 0, inProgress: 0, done: 0 }
  for (const card of board.cards) {
    if (card.status === 'todo') counts.todo += 1
    else if (card.status === 'in_progress') counts.inProgress += 1
    else counts.done += 1
  }
  return {
    path: boardPath(cwd),
    cards: board.cards,
    counts,
    ...archived !== undefined && archived.count > 0 ? { archived } : {},
  }
}

/** Input for creating a card. */
export interface AddCardInput {
  title: string
  description?: string
  /** What was done (Agent-Note style). */
  summary?: string
  /** Why it was done (Agent-Note style). */
  rationale?: string
  /** What was rejected / given up (Agent-Note style). */
  rejected?: string
  /** The session id that created the card (locate the handling session). */
  sourceSessionId?: string
  status?: BoardStatus
  tags?: string[]
}

/** Normalize an optional tag list: trim, drop empties, dedupe. */
function normalizeTags(tags: string[] | undefined): string[] {
  if (tags === undefined) return []
  const seen = new Set<string>()
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed !== '') seen.add(trimmed)
  }
  return [...seen]
}

/** Include a non-empty optional text field in a card object; empty clears it. */
function optionalText(target: Record<string, unknown>, field: 'description' | 'summary' | 'rationale' | 'rejected', value: string | undefined): void {
  if (value === undefined) return
  const trimmed = value.trim()
  if (trimmed === '') delete target[field]
  else target[field] = trimmed
}

/** Add one card and return the fresh board view. */
export async function addCard(cwd: string, input: AddCardInput): Promise<BoardView> {
  const title = input.title.trim()
  if (title === '') throw new TypeError('kanban: card title must be a non-empty string')
  if (input.status !== undefined && !BOARD_STATUSES.includes(input.status)) {
    throw new TypeError(`kanban: invalid status ${JSON.stringify(input.status)}`)
  }
  const board = await readBoard(cwd)
  const now = Date.now()
  const fields: Record<string, string> = {}
  optionalText(fields, 'description', input.description)
  optionalText(fields, 'summary', input.summary)
  optionalText(fields, 'rationale', input.rationale)
  optionalText(fields, 'rejected', input.rejected)
  const card: BoardCard = {
    id: `card-${randomUUID()}`,
    title,
    ...fields,
    ...input.sourceSessionId !== undefined && input.sourceSessionId !== ''
      ? { sourceSessionId: input.sourceSessionId }
      : {},
    status: input.status ?? 'todo',
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now,
  }
  board.cards.push(card)
  const archived = await archiveExcessDone(cwd, board)
  await writeBoard(cwd, board)
  return viewOf(cwd, board, archived)
}

/** Fields a caller may change on an existing card. */
export interface UpdateCardInput {
  title?: string
  description?: string
  summary?: string
  rationale?: string
  rejected?: string
  status?: BoardStatus
  tags?: string[]
}

/** Update one card in place and return the fresh board view. */
export async function updateCard(cwd: string, id: string, input: UpdateCardInput): Promise<BoardView> {
  if (id === '' || id.trim() !== id) throw new TypeError('kanban: card id must be a non-empty, untrimmed string')
  if (input.title !== undefined && input.title.trim() === '') {
    throw new TypeError('kanban: card title must be a non-empty string')
  }
  if (input.status !== undefined && !BOARD_STATUSES.includes(input.status)) {
    throw new TypeError(`kanban: invalid status ${JSON.stringify(input.status)}`)
  }
  if (input.title === undefined && input.description === undefined
    && input.summary === undefined && input.rationale === undefined
    && input.rejected === undefined && input.status === undefined && input.tags === undefined) {
    throw new TypeError('kanban: card update requires at least one field')
  }
  const board = await readBoard(cwd)
  const card = board.cards.find(candidate => candidate.id === id)
  if (card === undefined) throw new Error(`kanban: no card with id ${JSON.stringify(id)}`)
  if (input.title !== undefined) card.title = input.title.trim()
  if (input.description !== undefined) {
    const v = input.description.trim()
    if (v === '') delete card.description
    else card.description = v
  }
  if (input.summary !== undefined) {
    const v = input.summary.trim()
    if (v === '') delete card.summary
    else card.summary = v
  }
  if (input.rationale !== undefined) {
    const v = input.rationale.trim()
    if (v === '') delete card.rationale
    else card.rationale = v
  }
  if (input.rejected !== undefined) {
    const v = input.rejected.trim()
    if (v === '') delete card.rejected
    else card.rejected = v
  }
  if (input.status !== undefined) card.status = input.status
  if (input.tags !== undefined) card.tags = normalizeTags(input.tags)
  card.updatedAt = Date.now()
  const archived = await archiveExcessDone(cwd, board)
  await writeBoard(cwd, board)
  return viewOf(cwd, board, archived)
}

/** Remove one card and return the fresh board view. */
export async function removeCard(cwd: string, id: string): Promise<BoardView> {
  if (id === '' || id.trim() !== id) throw new TypeError('kanban: card id must be a non-empty, untrimmed string')
  const board = await readBoard(cwd)
  const index = board.cards.findIndex(card => card.id === id)
  if (index < 0) throw new Error(`kanban: no card with id ${JSON.stringify(id)}`)
  board.cards.splice(index, 1)
  const archived = await archiveExcessDone(cwd, board)
  await writeBoard(cwd, board)
  return viewOf(cwd, board, archived)
}
