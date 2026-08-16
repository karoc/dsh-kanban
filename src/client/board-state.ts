/**
 * Module-level board visibility state shared by the sidebar entry button and
 * the full-screen overlay page. A bare observable pair (subscribe/getSnapshot)
 * consumed through React's useSyncExternalStore — no store machinery needed for
 * a single boolean that two sibling entries must agree on.
 */
const listeners = new Set<() => void>()
let open = false

/** Subscribe to visibility changes; returns an unsubscribe. */
export function subscribeBoard(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Current visibility snapshot. */
export function getBoardOpen(): boolean {
  return open
}

/** Open the board page (called from the sidebar entry). */
export function openBoard(): void {
  if (open) return
  open = true
  for (const fn of listeners) fn()
}

/** Close the board page (called from the overlay's close control). */
export function closeBoard(): void {
  if (!open) return
  open = false
  for (const fn of listeners) fn()
}
