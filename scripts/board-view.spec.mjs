/**
 * Unit tests for the board page's view model (src/client/board-view.ts) and the
 * one CSS rule that bounds a card's height.
 *
 * The fixture is the audited failure case: a 108-card board whose done column
 * was read in *creation* order, so the cards finished most recently sat at the
 * bottom (one at #99 of 100 rows, 151 screens of scrolling). Every assertion
 * below is written against that shape, so a regression to createdAt ordering,
 * a dropped filter, or a done window that hides a search hit turns this file red.
 *
 * Run: node --test scripts/board-view.spec.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DONE_PAGE_SIZE,
  EMPTY_FILTERS,
  buildBoardView,
  cardMatchesQuery,
  collectTags,
  doneVisibleCount,
  doneWindowActive,
  filterCards,
  sortCards,
} from '../src/client/board-view.ts'

const BASE = Date.UTC(2026, 0, 1)
const MINUTE = 60_000

/**
 * The audited 108-card board.
 *
 * 8 todo + 20 in_progress + 80 done. `createdAt` ascends with the index, while
 * completion ascends in the OPPOSITE direction: the newest-created done card
 * finished first and the oldest-created done card finished last. That is the
 * real shape — creation order buried the recent work — and it is what makes the
 * ordering assertion meaningful (a `createdAt` sort puts index 107 first).
 */
function makeBoard() {
  const cards = []
  for (let index = 0; index < 108; index += 1) {
    const status = index < 8 ? 'todo' : index < 28 ? 'in_progress' : 'done'
    const doneIndex = index - 28
    const createdAt = BASE + index * MINUTE
    // Done cards: completion order is the reverse of creation order.
    const updatedAt = status === 'done' ? BASE + (80 - doneIndex) * 24 * MINUTE : createdAt
    cards.push({
      id: `card-${String(index).padStart(3, '0')}`,
      title: `Card ${String(index).padStart(3, '0')} title`,
      description: `Description body for card ${index} about the board page`,
      summary: `the !summary!${index}! token for card ${index}`,
      rationale: index % 2 === 0 ? `why-${index}` : '',
      rejected: index % 3 === 0 ? `rejected-${index}` : '',
      tags: [['web', 'api', 'docs', 'release'][index % 4]],
      status,
      createdAt,
      updatedAt,
    })
  }
  return cards
}

/** Every rendered card id, in render order. */
function renderedIds(view) {
  return [...view.groups.todo, ...view.groups.in_progress, ...view.groups.done].map(card => card.id)
}

test('done column is ordered by updatedAt: the most recently completed card is first', () => {
  const view = buildBoardView(makeBoard(), EMPTY_FILTERS, 1)
  // card-028 was created first among the done cards and finished last.
  assert.equal(view.groups.done[0].id, 'card-028', 'the most recently completed card must be first in done')
  // card-107 was created last, so a createdAt sort would put it first. (The
  // rendered column is windowed to 20, so the oldest completion is asserted on
  // the full ordering, not on the first page.)
  const doneInOrder = sortCards(makeBoard()).filter(card => card.status === 'done')
  assert.equal(doneInOrder.at(-1).id, 'card-107', 'the oldest completion must be last in done')
  assert.notEqual(view.groups.done[0].id, 'card-107', 'done must not be ordered by createdAt')
})

test('sortCards buckets by status, then by updatedAt, then createdAt, then id', () => {
  const sorted = sortCards(makeBoard())
  assert.deepEqual(sorted.slice(0, 8).map(card => card.status), Array(8).fill('todo'))
  assert.equal(sorted.filter(card => card.status === 'done').length, 80)
  // A tie on updatedAt falls back to createdAt (newest first), then id.
  const tie = sortCards([
    { id: 'b', title: 'b', tags: [], status: 'done', createdAt: 5, updatedAt: 9 },
    { id: 'a', title: 'a', tags: [], status: 'done', createdAt: 5, updatedAt: 9 },
    { id: 'c', title: 'c', tags: [], status: 'done', createdAt: 6, updatedAt: 9 },
  ])
  assert.deepEqual(tie.map(card => card.id), ['c', 'a', 'b'])
  // The input is not mutated.
  const input = makeBoard()
  const before = input.map(card => card.id)
  sortCards(input)
  assert.deepEqual(input.map(card => card.id), before)
})

test('the done column renders 20 cards and hides the rest behind load more', () => {
  const view = buildBoardView(makeBoard(), EMPTY_FILTERS, 1)
  assert.equal(DONE_PAGE_SIZE, 20)
  assert.equal(view.groups.done.length, 20)
  assert.equal(view.totals.done, 80, 'the column badge still reports every matching card')
  assert.equal(view.doneHidden, 60)
  assert.equal(doneWindowActive(EMPTY_FILTERS), true)
})

test('one load-more click reveals the next page of done cards', () => {
  const board = makeBoard()
  const page1 = buildBoardView(board, EMPTY_FILTERS, 1)
  const page2 = buildBoardView(board, EMPTY_FILTERS, 2)
  assert.equal(page2.groups.done.length, 2 * DONE_PAGE_SIZE)
  assert.equal(page2.doneHidden, 40)
  // The second page continues exactly where the first one stopped: no gap, no repeat.
  assert.deepEqual(
    page2.groups.done.slice(0, DONE_PAGE_SIZE).map(card => card.id),
    page1.groups.done.map(card => card.id),
  )
  assert.equal(new Set(page2.groups.done.map(card => card.id)).size, 40)
  // Growing past the end clamps instead of inventing an empty extra page.
  assert.equal(buildBoardView(board, EMPTY_FILTERS, 99).groups.done.length, 80)
  assert.equal(buildBoardView(board, EMPTY_FILTERS, 99).doneHidden, 0)
  assert.equal(doneVisibleCount(80, 0), DONE_PAGE_SIZE, 'pages are 1-based and never below 1')
})

test('every card is reachable in at most two operations', () => {
  const board = makeBoard()
  const firstRender = new Set(renderedIds(buildBoardView(board, EMPTY_FILTERS, 1)))
  let hidden = 0
  for (const card of board) {
    if (firstRender.has(card.id)) continue
    hidden += 1
    // Operation 1: type the card's own title into the search box.
    const searched = buildBoardView(board, { query: card.title, status: 'all', tag: undefined }, 1)
    assert.deepEqual(
      renderedIds(searched),
      [card.id],
      `searching "${card.title}" must render that card and nothing else`,
    )
    // The same card is also one click away when it merely sits on the second page.
    const doneIndex = buildBoardView(board, EMPTY_FILTERS, 1).totals.done === 0
      ? -1
      : board.filter(other => other.status === 'done')
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .findIndex(other => other.id === card.id)
    if (doneIndex >= 0 && doneIndex < 2 * DONE_PAGE_SIZE) {
      assert.ok(
        renderedIds(buildBoardView(board, EMPTY_FILTERS, 2)).includes(card.id),
        'a card on the second done page must appear after one load-more click',
      )
    }
  }
  assert.ok(hidden > 0, 'the fixture must hide cards, otherwise the reachability test proves nothing')
})

test('search matches every rendered field, case-insensitively', () => {
  const board = makeBoard()
  const byTitle = buildBoardView(board, { query: 'card 042', status: 'all', tag: undefined }, 1)
  assert.deepEqual(byTitle.groups.done.map(card => card.id), ['card-042'])
  // A term that exists only in the summary, only in the description, only in a
  // tag, and only in the id must all find the same card.
  for (const query of ['!summary!42!', 'board page', 'docs', 'card-042']) {
    const view = buildBoardView(board, { query, status: 'all', tag: undefined }, 1)
    assert.ok(renderedIds(view).includes('card-042'), `"${query}" must match card-042 via its body`)
  }
  assert.equal(cardMatchesQuery(board[42], '   '), true, 'a blank query matches everything')
  assert.equal(cardMatchesQuery(board[42], 'nope'), false)
})

test('whitespace-separated search terms are ANDed', () => {
  const board = makeBoard()
  const both = buildBoardView(board, { query: 'card-007 title', status: 'all', tag: undefined }, 1)
  assert.deepEqual(renderedIds(both), ['card-007'])
  const impossible = buildBoardView(board, { query: 'card-007 card-008', status: 'all', tag: undefined }, 1)
  assert.deepEqual(renderedIds(impossible), [])
})

test('the status filter narrows to one column without dropping the others from the index', () => {
  const board = makeBoard()
  const doneOnly = buildBoardView(board, { query: '', status: 'done', tag: undefined }, 1)
  assert.equal(doneOnly.groups.todo.length, 0)
  assert.equal(doneOnly.groups.in_progress.length, 0)
  assert.equal(doneOnly.totals.done, 80)
  const todoOnly = buildBoardView(board, { query: '', status: 'todo', tag: undefined }, 1)
  assert.equal(todoOnly.groups.todo.length, 8)
  assert.equal(renderedIds(todoOnly).length, 8)
})

test('the tag filter is exact, and the tag index counts the whole board', () => {
  const board = makeBoard()
  const tags = collectTags(board)
  assert.deepEqual(tags.map(entry => entry.tag), ['api', 'docs', 'release', 'web'], 'ties sort alphabetically')
  assert.deepEqual(tags.map(entry => entry.count), [27, 27, 27, 27])
  const api = buildBoardView(board, { query: '', status: 'all', tag: 'api' }, 1)
  assert.equal(api.totals.todo + api.totals.in_progress + api.totals.done, 27)
  assert.ok([...api.groups.todo, ...api.groups.in_progress, ...api.groups.done]
    .every(card => card.tags.includes('api')))
  // Substrings are not tag filters.
  const partial = buildBoardView(board, { query: '', status: 'all', tag: 'ap' }, 1)
  assert.equal(renderedIds(partial).length, 0)
})

test('a narrowing filter lifts the done window so a search hit is never hidden', () => {
  const board = makeBoard()
  // "title" matches all 108 cards, so a remaining window would hide 60 of them.
  const all = buildBoardView(board, { query: 'title', status: 'all', tag: undefined }, 1)
  assert.equal(all.narrowed, true)
  assert.equal(all.doneHidden, 0)
  assert.equal(all.groups.done.length, 80, 'a filtered done column shows every match')
  assert.equal(doneWindowActive({ query: 'x', status: 'all', tag: undefined }), false)
  assert.equal(doneWindowActive({ query: '', status: 'all', tag: 'api' }), false)
})

test('an unmatched query renders three empty columns instead of the window', () => {
  const view = buildBoardView(makeBoard(), { query: 'zzz-no-such-card', status: 'all', tag: undefined }, 1)
  assert.deepEqual(renderedIds(view), [])
  assert.deepEqual(view.totals, { todo: 0, in_progress: 0, done: 0 })
  assert.equal(view.doneHidden, 0)
})

test('filterCards preserves input order and never mutates', () => {
  const board = makeBoard()
  const filtered = filterCards(board, { query: '!summary!7! ', status: 'all', tag: undefined })
  assert.deepEqual(filtered.map(card => card.id), ['card-007'])
  assert.equal(board.length, 108)
})

test('the card description is clamped to two lines by its CSS rule', async () => {
  const { KANBAN_STYLES } = await import('../src/client/styles.ts')
  const rule = /(?:^|\n)\.kb-card-desc\s*\{([^}]*)\}/.exec(KANBAN_STYLES)
  assert.ok(rule, '.kb-card-desc must have a style rule')
  const body = rule[1]
  assert.match(body, /-webkit-line-clamp:\s*2\b/, 'the description must be clamped to two lines')
  assert.match(body, /display:\s*-webkit-box/, 'line clamping needs the -webkit-box display')
  assert.match(body, /overflow:\s*hidden/, 'the clamp only works with overflow: hidden')
})
