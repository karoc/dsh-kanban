/**
 * Pure view-model logic for the board page: ordering, free-text search, status
 * and tag filters, and the done column's page window.
 *
 * Deliberately free of React/DSH imports: `node --test` imports this file with
 * type-stripping (same pattern as `board-core.ts`), so the rules that decide
 * what a 108-card board renders are asserted in CI instead of eyeballed.
 *
 * Why the done column is ordered by `updatedAt`: a card's `createdAt` is the
 * day it was WRITTEN, but a done column is read by the day work FINISHED. On the
 * audited 108-card board the ten cards finished most recently had the ten
 * oldest `createdAt` values, so creation order buried them below row 20 (one at
 * #99) — the most recent completion was the least visible card.
 */

/** The subset of a card the view rules need (structurally satisfied by BoardCardView). */
export interface ViewCard {
  id: string
  title: string
  description?: string
  summary?: string
  rationale?: string
  rejected?: string
  tags: string[]
  status: 'todo' | 'in_progress' | 'done'
  createdAt: number
  updatedAt: number
}

/** A board status. */
export type CardStatus = ViewCard['status']

/** Column order, left to right. */
export const STATUS_ORDER: readonly CardStatus[] = ['todo', 'in_progress', 'done']

/**
 * Done-column page window: 20 cards per step.
 *
 * 20 is "a screen and a half" at the audited card height, which keeps the first
 * paint of a 108-card board bounded without hiding the recent end of the board:
 * the cards a reader wants are the ones just finished, and they are now first.
 */
export const DONE_PAGE_SIZE = 20

/** Which columns are visible: every status, or exactly one. */
export type StatusFilter = 'all' | CardStatus

/** The whole filter state the page owns. */
export interface BoardFilters {
  /** Free-text query (whitespace-separated terms are ANDed). */
  query: string
  status: StatusFilter
  /** Exact tag filter, or undefined for "any tag". */
  tag: string | undefined
}

/** The unfiltered board. */
export const EMPTY_FILTERS: BoardFilters = { query: '', status: 'all', tag: undefined }

/** One tag with the number of cards carrying it. */
export interface TagCount {
  tag: string
  count: number
}

/** What the page renders for one board + filter state. */
export interface BoardView<T extends ViewCard> {
  /** Cards per column, in render order (the done column is already windowed). */
  groups: { [K in CardStatus]: T[] }
  /** Matching cards per column BEFORE the done window — the column badge. */
  totals: { [K in CardStatus]: number }
  /** Done cards behind the "load more" button (0 when the window is lifted). */
  doneHidden: number
  /** Every tag on the board (unfiltered) with its card count. */
  tags: TagCount[]
  /** True when a query or tag narrows the board, which lifts the done window. */
  narrowed: boolean
}

/** Locale-independent string ordering (deterministic across machines). */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Order the board: status bucket first, then the card touched most recently.
 *
 * `updatedAt` decides within a status (a done card is read by its finish day),
 * `createdAt` breaks ties (a card edited in the same millisecond), and the id
 * makes the order total so a poll that returns the same board cannot reshuffle
 * the DOM and drop the reader's scroll position.
 * @param cards - the cards as served by the host route.
 * @returns a new array; the input is never mutated.
 */
export function sortCards<T extends ViewCard>(cards: readonly T[]): T[] {
  const rank: { [K in CardStatus]: number } = { todo: 0, in_progress: 1, done: 2 }
  return [...cards].sort((left, right) => {
    const byStatus = rank[left.status] - rank[right.status]
    if (byStatus !== 0) return byStatus
    const byUpdated = right.updatedAt - left.updatedAt
    if (byUpdated !== 0) return byUpdated
    const byCreated = right.createdAt - left.createdAt
    if (byCreated !== 0) return byCreated
    return compareText(left.id, right.id)
  })
}

/** The searchable text of one card (every field the page can show). */
function searchableText(card: ViewCard): string {
  return [
    card.id,
    card.title,
    card.description ?? '',
    card.summary ?? '',
    card.rationale ?? '',
    card.rejected ?? '',
    card.tags.join(' '),
  ].join('\n').toLowerCase()
}

/**
 * Does a card match a free-text query?
 *
 * Case-insensitive; every whitespace-separated term must appear somewhere in the
 * card (id, title, description, what/why/rejected, tags), so "0.2.14 search"
 * finds the card that mentions both without caring about field boundaries.
 * @param card - one card.
 * @param query - raw user input; empty/blank matches everything.
 */
export function cardMatchesQuery(card: ViewCard, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(term => term !== '')
  if (terms.length === 0) return true
  const haystack = searchableText(card)
  return terms.every(term => haystack.includes(term))
}

/**
 * Apply the status + tag + query filters.
 * @param cards - any card list.
 * @param filters - current filter state.
 * @returns the matching cards, input order preserved.
 */
export function filterCards<T extends ViewCard>(cards: readonly T[], filters: BoardFilters): T[] {
  return cards.filter(card =>
    (filters.status === 'all' || card.status === filters.status)
    && (filters.tag === undefined || card.tags.includes(filters.tag))
    && cardMatchesQuery(card, filters.query))
}

/**
 * Tag index for the filter chips: most-used first, then alphabetical.
 * @param cards - usually the unfiltered board, so chips do not vanish as you filter.
 */
export function collectTags(cards: readonly ViewCard[]): TagCount[] {
  const counts = new Map<string, number>()
  for (const card of cards) {
    for (const tag of card.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || compareText(left.tag, right.tag))
}

/**
 * How many done cards one page step shows.
 * @param total - matching done cards.
 * @param pages - 1-based page count (the page starts at 1 and grows by one click).
 */
export function doneVisibleCount(total: number, pages: number): number {
  const page = Number.isFinite(pages) ? Math.max(1, Math.trunc(pages)) : 1
  return Math.min(total, page * DONE_PAGE_SIZE)
}

/**
 * Is the done window in force? A query or a tag narrows the board, and then the
 * matching done cards are all shown: a search result that still hides its hit
 * behind "load more" is not a search result.
 * @param filters - current filter state.
 */
export function doneWindowActive(filters: BoardFilters): boolean {
  return filters.query.trim() === '' && filters.tag === undefined
}

/**
 * Build the render model: order, filter, group, then window the done column.
 * @param cards - the cards as served by the host route.
 * @param filters - current filter state.
 * @param pages - done-column page count (ignored while a filter narrows the board).
 */
export function buildBoardView<T extends ViewCard>(
  cards: readonly T[],
  filters: BoardFilters,
  pages: number,
): BoardView<T> {
  const matching = filterCards(sortCards(cards), filters)
  const groups: { [K in CardStatus]: T[] } = { todo: [], in_progress: [], done: [] }
  for (const card of matching) groups[card.status].push(card)
  const totals: { [K in CardStatus]: number } = {
    todo: groups.todo.length,
    in_progress: groups.in_progress.length,
    done: groups.done.length,
  }
  const windowed = doneWindowActive(filters)
  const visible = windowed ? doneVisibleCount(totals.done, pages) : totals.done
  const doneHidden = totals.done - visible
  if (doneHidden > 0) groups.done = groups.done.slice(0, visible)
  return {
    groups,
    totals,
    doneHidden,
    tags: collectTags(cards),
    narrowed: filters.query.trim() !== '' || filters.tag !== undefined,
  }
}
