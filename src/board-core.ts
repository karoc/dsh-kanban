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
import { closeSync, openSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
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
 * One card as a single model-visible render line. The id must lead the line:
 * `output.render` is the only content a tool result exposes to the model, so an
 * id present only in the canonical value is unreachable (board_update would be
 * uncallable without shelling out to read KANBAN.json).
 * @param card - the card to render.
 * @returns the line, with tags and missing-field flags.
 */
export function renderCardLine(card: BoardCard): string {
  const missing = missingCardFields(card)
  const mark = missing.length > 0
    ? ` ⚠️缺:${missing.map(field => CARD_FIELD_LABELS[field]).join(',')}`
    : ''
  return `- [${card.status}] ${card.id} ${card.title}${card.tags.length > 0 ? ` ${card.tags.map(tag => `#${tag}`).join(' ')}` : ''}${mark}`
}

/** The three Agent-Note-style what/why/rejected fields of a card. */
export type CardQualityField = 'summary' | 'rationale' | 'rejected'

/**
 * Short labels for the what/why/rejected fields, used by model-visible render
 * (tool output, `/kanban` command, session-start snapshot). Chinese matches
 * the Web board page's zh copy for the three fields.
 */
export const CARD_FIELD_LABELS: Record<CardQualityField, string> = {
  summary: '做了什么',
  rationale: '为什么',
  rejected: '放弃了什么',
}

/**
 * Which of the three what/why/rejected fields a card is missing under the
 * card-completeness discipline:
 *   - every card must carry rationale (why it exists and why now) — a
 *     title-only card is incomplete;
 *   - a done card must be self-explanatory for the next session: summary +
 *     rationale + rejected all present.
 * Open cards may legitimately lack summary (nothing done yet) and rejected
 * (no alternative decision made yet), so only rationale is required while
 * open. Returns missing field names in fixed order (rationale, summary,
 * rejected). Shared by the tool render, the session-start snapshot, and the
 * completeness audit so every surface applies the same rule.
 */
export function missingCardFields(card: Pick<BoardCard, 'status' | 'summary' | 'rationale' | 'rejected'>): CardQualityField[] {
  const missing: CardQualityField[] = []
  if (card.rationale === undefined || card.rationale.trim() === '') missing.push('rationale')
  if (card.status === 'done') {
    if (card.summary === undefined || card.summary.trim() === '') missing.push('summary')
    if (card.rejected === undefined || card.rejected.trim() === '') missing.push('rejected')
  }
  return missing
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
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify(board, null, 2) + '\n', 'utf8')
  await renameWithRetry(tmp, path)
}

/**
 * Rename with bounded retry for Windows: the board page polls KANBAN.json and
 * can hold a read handle for a few milliseconds; `rename()` over a file that
 * is momentarily open fails with EPERM there. Retry with short backoff before
 * giving up; POSIX targets rename on the first attempt.
 */
export async function renameWithRetry(tmp: string, path: string, attempts = 5): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM' || attempt >= attempts - 1) throw error
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)))
    }
  }
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
  let raw: string | undefined
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (raw !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`kanban: archive ${path} is not valid JSON (${(error as Error).message}); refusing to overwrite it`)
    }
    const archive = parsed as { version?: unknown; archived?: unknown }
    if (archive.version !== 1 || !Array.isArray(archive.archived) || !archive.archived.every(isBoardCard)) {
      throw new Error(`kanban: archive ${path} is not a recognized {version:1, archived:[…]} document; refusing to overwrite it`)
    }
    existing = archive.archived
  }
  // Dedupe by id: an archive-first crash (archive written, board not yet)
  // must not append the same card twice on the next mutation.
  const known = new Set(existing.map(card => card.id))
  const appended = toArchive.filter(card => !known.has(card.id))
  existing.push(...appended)
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  await writeFile(tmp, JSON.stringify({ version: 1, archived: existing }, null, 2) + '\n', 'utf8')
  await renameWithRetry(tmp, path)
  return { count: appended.length, path }
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

/** Path of the advisory lock guarding one board's read-modify-write. */
export function boardLockPath(cwd: string): string {
  return `${boardPath(cwd)}.lock`
}

/** How long a writer waits for a live holder before failing loudly. */
const BOARD_LOCK_WAIT_MS = 10_000
/** Retry interval while another live writer holds the lock. */
const BOARD_LOCK_RETRY_MS = 25
/** Age after which a lock written on another host (unverifiable pid) is stale. */
const BOARD_LOCK_REMOTE_STALE_MS = 120_000
/** Age after which an unreadable/legacy lock file is treated as stale. */
const BOARD_LOCK_UNREADABLE_STALE_MS = 15_000
/** Heartbeat interval: keeps mtime fresh for the cross-host age fallback. */
const BOARD_LOCK_HEARTBEAT_MS = 2_000

/** Lock paths currently held BY THIS PROCESS → their token. */
const heldBoardLocks = new Map<string, string>()

/** Identity written into the lock file; ownership is checked against it. */
interface BoardLockInfo {
  /** Random per-acquisition token (release only removes the file it owns). */
  token: string
  /** Writer process id; same-host liveness is checked before any takeover. */
  pid: number
  /** Writer host; a pid means nothing across hosts. */
  host: string
  /** Acquisition time (diagnostics; staleness uses mtime/liveness). */
  acquiredAt: number
}

/** Read and validate a lock file; undefined when unreadable/legacy/corrupt. */
function readBoardLockInfo(lock: string): BoardLockInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(lock, 'utf8')) as Partial<BoardLockInfo>
    if (typeof parsed.token !== 'string' || parsed.token === '') return undefined
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) return undefined
    if (typeof parsed.host !== 'string') return undefined
    return {
      token: parsed.token,
      pid: parsed.pid,
      host: parsed.host,
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : 0,
    }
  } catch {
    return undefined
  }
}

/** Whether a same-host pid still exists (EPERM counts as alive). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Age of the lock file in ms, or undefined when it cannot be stat-ed. */
function boardLockAgeMs(lock: string): number | undefined {
  try {
    return Date.now() - statSync(lock).mtimeMs
  } catch {
    return undefined
  }
}

/**
 * Decide whether a lock may be taken over:
 *  - same host: the recorded pid must be gone (a suspended/GC-paused live
 *    holder keeps its pid, so its lock is never stolen);
 *  - other/unreadable host: age-based fallback (no cross-host liveness probe).
 */
function isBoardLockStale(lock: string, info: BoardLockInfo | undefined, age: number | undefined): boolean {
  if (info === undefined || info.host !== hostname()) {
    const limit = info === undefined ? BOARD_LOCK_UNREADABLE_STALE_MS : BOARD_LOCK_REMOTE_STALE_MS
    return age !== undefined && age > limit
  }
  if (info.pid === process.pid) {
    // Same process: a lock carrying our live token is held by a concurrent
    // caller of THIS process and must be waited for, not stolen. A different
    // token with our pid is a leftover from a process that crashed and whose
    // pid was recycled: take it over.
    if (heldBoardLocks.get(lock) === info.token) return false
    return true
  }
  return !pidAlive(info.pid)
}

/**
 * Break a stale lock without ever unlinking a live holder's lock: move the
 * candidate aside, verify the moved inode still carries the token we judged
 * stale, then delete it. A racing takeover restores the file if the token
 * changed between the decision and the rename.
 */
async function takeOverBoardLock(lock: string, expected: BoardLockInfo | undefined): Promise<void> {
  const moved = `${lock}.stale-${randomUUID()}`
  try {
    await rename(lock, moved)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const observed = readBoardLockInfo(moved)
  const sameOwner = expected === undefined ? observed === undefined : observed?.token === expected.token
  if (!sameOwner) {
    // Someone replaced the lock between our decision and the rename: put it back.
    try {
      await rename(moved, lock)
    } catch {
      // Lock path already repopulated; leave the moved file for manual cleanup.
    }
    return
  }
  try {
    await unlink(moved)
  } catch {
    // Already gone.
  }
}

/**
 * Acquire the advisory board lock (`KANBAN.json.lock`, created with O_EXCL).
 * Multiple sessions/agents share one KANBAN.json; without this a read-modify-write
 * pair can lose an update (each writer reads the same snapshot, last rename wins).
 * Ownership is token-checked: release only removes the file this acquisition
 * created, and a live holder is never treated as stale (a dead same-host pid is
 * the takeover signal; cross-host locks fall back to age).
 * @param cwd - absolute workspace root.
 * @returns the release function (idempotent, ownership-checked).
 */
async function acquireBoardLock(cwd: string): Promise<() => void> {
  const lock = boardLockPath(cwd)
  const token = randomUUID()
  const deadline = Date.now() + BOARD_LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      try {
        const info: BoardLockInfo = { token, pid: process.pid, host: hostname(), acquiredAt: Date.now() }
        writeFileSync(fd, JSON.stringify(info), 'utf8')
      } finally {
        closeSync(fd)
      }
      heldBoardLocks.set(lock, token)
      const heartbeat = setInterval(() => {
        try {
          const now = new Date()
          utimesSync(lock, now, now)
        } catch {
          // The lock vanished (external cleanup); the held mutation still owns
          // the board until it finishes, and its release becomes a no-op.
        }
      }, BOARD_LOCK_HEARTBEAT_MS)
      heartbeat.unref?.()
      return () => {
        clearInterval(heartbeat)
        releaseBoardLock(lock, token)
        if (heldBoardLocks.get(lock) === token) heldBoardLocks.delete(lock)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const info = readBoardLockInfo(lock)
      const age = boardLockAgeMs(lock)
      if (isBoardLockStale(lock, info, age)) {
        await takeOverBoardLock(lock, info)
        continue
      }
      if (Date.now() > deadline) {
        const holder = info === undefined ? 'an unreadable lock file' : `pid ${info.pid} on ${info.host}`
        throw new Error(`kanban: board is locked by ${holder} (${lock}); retry the operation`)
      }
      await sleep(BOARD_LOCK_RETRY_MS)
    }
  }
}

/** Remove the lock only when this acquisition still owns it. */
function releaseBoardLock(lock: string, token: string): void {
  if (readBoardLockInfo(lock)?.token !== token) return
  try {
    unlinkSync(lock)
  } catch {
    // Already gone or unlinkable; never throw from a release path.
  }
}

/**
 * Run one board mutation under the advisory lock.
 * @param cwd - absolute workspace root.
 * @param fn - read → mutate → write body; must not call another locked mutation.
 * @returns the body's result.
 */
export async function withBoardLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireBoardLock(cwd)
  try {
    return await fn()
  } finally {
    release()
  }
}

/** One mutation's outcome: the fresh board plus the card it touched. *//** One mutation's outcome: the fresh board plus the card it touched. */
export interface BoardMutation {
  /** The fresh board view (same shape the Web route and `/kanban` render). */
  view: BoardView
  /** The created or updated card; undefined for a removal. */
  card?: BoardCard
  /** The id removed by a removal operation. */
  removedId?: string
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
export async function addCard(cwd: string, input: AddCardInput): Promise<BoardMutation> {
  const title = input.title.trim()
  if (title === '') throw new TypeError('kanban: card title must be a non-empty string')
  if (input.status !== undefined && !BOARD_STATUSES.includes(input.status)) {
    throw new TypeError(`kanban: invalid status ${JSON.stringify(input.status)}`)
  }
  return await withBoardLock(cwd, async () => {
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
    return { view: viewOf(cwd, board, archived), card }
  })
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
export async function updateCard(cwd: string, id: string, input: UpdateCardInput): Promise<BoardMutation> {
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
  return await withBoardLock(cwd, async () => {
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
    return { view: viewOf(cwd, board, archived), card }
  })
}

/** Remove one card and return the fresh board view. */
export async function removeCard(cwd: string, id: string): Promise<BoardMutation> {
  if (id === '' || id.trim() !== id) throw new TypeError('kanban: card id must be a non-empty, untrimmed string')
  return await withBoardLock(cwd, async () => {
    const board = await readBoard(cwd)
    const index = board.cards.findIndex(card => card.id === id)
    if (index < 0) throw new Error(`kanban: no card with id ${JSON.stringify(id)}`)
    board.cards.splice(index, 1)
    const archived = await archiveExcessDone(cwd, board)
    await writeBoard(cwd, board)
    return { view: viewOf(cwd, board, archived), removedId: id }
  })
}
