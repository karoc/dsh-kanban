/**
 * Unit tests for the KANBAN.json domain (board-core.ts): CRUD, validation,
 * atomic writes, and file-shape guards. Runs on the built lib with node:test.
 * Run: node --test scripts/board-core.spec.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, sep } from 'node:path'
import {
  addCard,
  boardPath,
  isBoardCard,
  isBoardData,
  readBoard,
  removeCard,
  renameWithRetry,
  updateCard,
} from '../src/board-core.ts'

/** Create a fresh temp workspace per test. */
async function freshWorkspace() {
  return await mkdtemp(join(tmpdir(), 'kanban-test-'))
}

test('boardPath requires an absolute workspace', () => {
  assert.throws(() => boardPath('relative/path'), /absolute/)
  const p = boardPath('/abs')
  // Path separators differ per platform (POSIX '/' vs Windows '\'): assert the
  // contract (absolute + board filename) instead of a hardcoded separator.
  assert.ok(isAbsolute(p), `boardPath must return an absolute path, got ${p}`)
  assert.ok(p.endsWith(`${sep}KANBAN.json`), `boardPath must end with ${sep}KANBAN.json, got ${p}`)
})

test('readBoard returns an empty board when the file is missing', async () => {
  const ws = await freshWorkspace()
  const board = await readBoard(ws)
  assert.deepEqual(board, { version: 1, cards: [] })
  await rm(ws, { recursive: true, force: true })
})

test('readBoard fails loud on a structurally broken file', async () => {
  const ws = await freshWorkspace()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(ws, 'KANBAN.json'), JSON.stringify({ version: 1, cards: 'nope' }), 'utf8')
  await assert.rejects(() => readBoard(ws), /does not match the KANBAN\.json shape/)
  await rm(ws, { recursive: true, force: true })
})

test('readBoard fails loud on invalid JSON', async () => {
  const ws = await freshWorkspace()
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(ws, 'KANBAN.json'), '{ not json', 'utf8')
  await assert.rejects(() => readBoard(ws), /not valid JSON/)
  await rm(ws, { recursive: true, force: true })
})

test('addCard writes the card and persists to disk with version 1', async () => {
  const ws = await freshWorkspace()
  const view = await addCard(ws, { title: '实现看板', description: '跨会话', tags: ['dsh'] })
  assert.equal(view.cards.length, 1)
  const card = view.cards[0]
  assert.equal(card.title, '实现看板')
  assert.equal(card.description, '跨会话')
  assert.equal(card.status, 'todo')
  assert.deepEqual(card.tags, ['dsh'])
  assert.ok(card.id.startsWith('card-'))
  assert.equal(view.counts.todo, 1)
  // Persisted document on disk.
  const raw = JSON.parse(await readFile(boardPath(ws), 'utf8'))
  assert.equal(raw.version, 1)
  assert.equal(raw.cards.length, 1)
  assert.equal(raw.cards[0].id, card.id)
  await rm(ws, { recursive: true, force: true })
})

test('addCard rejects empty or whitespace-only titles', async () => {
  const ws = await freshWorkspace()
  await assert.rejects(() => addCard(ws, { title: '   ' }), /non-empty/)
  await assert.rejects(() => addCard(ws, { title: '' }), /non-empty/)
  await rm(ws, { recursive: true, force: true })
})

test('addCard rejects unknown statuses', async () => {
  const ws = await freshWorkspace()
  await assert.rejects(() => addCard(ws, { title: 'x', status: 'archived' }), /invalid status/)
  await rm(ws, { recursive: true, force: true })
})

test('addCard normalizes tags (trim, drop empties, dedupe)', async () => {
  const ws = await freshWorkspace()
  const view = await addCard(ws, { title: 'x', tags: [' dsh ', '', 'dsh', 'urgent'] })
  assert.deepEqual(view.cards[0].tags, ['dsh', 'urgent'])
  await rm(ws, { recursive: true, force: true })
})

test('updateCard moves status and bumps updatedAt', async () => {
  const ws = await freshWorkspace()
  const added = await addCard(ws, { title: '任务' })
  const id = added.cards[0].id
  const before = added.cards[0].updatedAt
  const view = await updateCard(ws, id, { status: 'in_progress' })
  assert.equal(view.cards[0].status, 'in_progress')
  assert.ok(view.cards[0].updatedAt >= before)
  assert.equal(view.counts.inProgress, 1)
  await rm(ws, { recursive: true, force: true })
})

test('updateCard rejects unknown ids', async () => {
  const ws = await freshWorkspace()
  await assert.rejects(() => updateCard(ws, 'card-missing', { status: 'done' }), /no card/)
  await rm(ws, { recursive: true, force: true })
})

test('updateCard clears description with empty string', async () => {
  const ws = await freshWorkspace()
  const added = await addCard(ws, { title: 'x', description: 'note' })
  const id = added.cards[0].id
  const view = await updateCard(ws, id, { description: '' })
  assert.equal(view.cards[0].description, undefined)
  await rm(ws, { recursive: true, force: true })
})

test('updateCard requires at least one field', async () => {
  const ws = await freshWorkspace()
  const added = await addCard(ws, { title: 'x' })
  await assert.rejects(() => updateCard(ws, added.cards[0].id, {}), /at least one field/)
  await rm(ws, { recursive: true, force: true })
})

test('removeCard deletes the card and returns the fresh view', async () => {
  const ws = await freshWorkspace()
  const a = await addCard(ws, { title: 'a' })
  const b = await addCard(ws, { title: 'b' })
  const view = await removeCard(ws, a.cards[0].id)
  assert.equal(view.cards.length, 1)
  assert.equal(view.cards[0].title, 'b')
  await assert.rejects(() => removeCard(ws, a.cards[0].id), /no card/)
  await rm(ws, { recursive: true, force: true })
})

test('addCard stores the what/why/rejected fields', async () => {
  const ws = await freshWorkspace()
  const view = await addCard(ws, {
    title: '决策笔记',
    summary: '做了看板插件',
    rationale: '跨会话不丢',
    rejected: '放弃了 markdown 方案',
  })
  assert.equal(view.cards[0].summary, '做了看板插件')
  assert.equal(view.cards[0].rationale, '跨会话不丢')
  assert.equal(view.cards[0].rejected, '放弃了 markdown 方案')
  await rm(ws, { recursive: true, force: true })
})

test('updateCard sets and clears the what/why/rejected fields', async () => {
  const ws = await freshWorkspace()
  const added = await addCard(ws, { title: 'x' })
  const id = added.cards[0].id
  const set = await updateCard(ws, id, { summary: 's', rationale: 'r', rejected: 'x' })
  assert.equal(set.cards[0].summary, 's')
  assert.equal(set.cards[0].rationale, 'r')
  assert.equal(set.cards[0].rejected, 'x')
  const cleared = await updateCard(ws, id, { summary: '', rationale: '' })
  assert.equal(cleared.cards[0].summary, undefined)
  assert.equal(cleared.cards[0].rationale, undefined)
  assert.equal(cleared.cards[0].rejected, 'x')
  await rm(ws, { recursive: true, force: true })
})

test('shape guards accept and reject the what/why/rejected fields', () => {
  const valid = {
    version: 1,
    cards: [{
      id: 'card-1', title: 't', status: 'todo', tags: [],
      summary: 's', rationale: 'r', rejected: 'x', createdAt: 1, updatedAt: 2,
    }],
  }
  assert.equal(isBoardData(valid), true)
  assert.equal(isBoardCard({ ...valid.cards[0], summary: 42 }), false)
  assert.equal(isBoardCard({ ...valid.cards[0], rationale: 42 }), false)
  assert.equal(isBoardCard({ ...valid.cards[0], rejected: 42 }), false)
})

test('shape guards accept valid values and reject invalid ones', () => {
  const valid = {
    version: 1,
    cards: [{
      id: 'card-1', title: 't', status: 'todo', tags: [], createdAt: 1, updatedAt: 2,
    }],
  }
  assert.equal(isBoardData(valid), true)
  assert.equal(isBoardData({ version: 2, cards: [] }), false)
  assert.equal(isBoardData({ version: 1, cards: 'x' }), false)
  assert.equal(isBoardCard(valid.cards[0]), true)
  assert.equal(isBoardCard({ ...valid.cards[0], status: 'archived' }), false)
  assert.equal(isBoardCard({ ...valid.cards[0], tags: [1] }), false)
})

test('addCard records the source session id', async () => {
  const ws = await freshWorkspace()
  const view = await addCard(ws, { title: 's', sourceSessionId: 'session-abc' })
  assert.equal(view.cards[0].sourceSessionId, 'session-abc')
  await rm(ws, { recursive: true, force: true })
})

test('done cards beyond MAX_DONE_CARDS are archived to .agents/notes/archive.json', async () => {
  const ws = await freshWorkspace()
  const { MAX_DONE_CARDS, archivePath } = await import('../src/board-core.ts')
  // Create more than the cap of done cards (each add marks done).
  const total = MAX_DONE_CARDS + 5
  let last
  for (let i = 0; i < total; i++) {
    last = await addCard(ws, { title: `done-${i}`, status: 'done' })
  }
  // Live board keeps at most MAX_DONE_CARDS done cards.
  const doneLive = last.cards.filter(c => c.status === 'done').length
  assert.equal(doneLive, MAX_DONE_CARDS)
  // Archived file holds the 5 oldest done cards (each mutation archives the
  // oldest excess, so the final archived set is the 5 earliest done cards).
  const raw = JSON.parse(await readFile(archivePath(ws), 'utf8'))
  assert.equal(raw.archived.length, 5)
  assert.equal(raw.archived[0].title, 'done-0')
  assert.equal(raw.archived[4].title, 'done-4')
  await rm(ws, { recursive: true, force: true })
})

test('renameWithRetry succeeds when the target is briefly held open (Windows EPERM race)', async () => {
  const ws = await freshWorkspace()
  const target = join(ws, 'KANBAN.json')
  const { writeFile, open, rename } = await import('node:fs/promises')
  // Commit the target so the temp rename has something to replace.
  await writeFile(target, '{"version":1,"cards":[]}\n', 'utf8')
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, '{"version":1,"cards":[{"id":"card-1"}]}\n', 'utf8')
  // Hold a read handle on the target (the board page's poll does the same);
  // release it shortly after the first rename attempt would collide.
  const handle = await open(target, 'r')
  setTimeout(() => void handle.close(), 60)
  // On Windows the first rename-over-open-file attempt fails with EPERM and
  // the retry loop lands after the handle closes; on POSIX it succeeds at once.
  await renameWithRetry(tmp, target, 10)
  const raw = JSON.parse(await readFile(target, 'utf8'))
  assert.equal(raw.cards.length, 1)
  assert.equal(raw.cards[0].id, 'card-1')
  await rm(ws, { recursive: true, force: true })
})
