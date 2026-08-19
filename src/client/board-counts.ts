/**
 * Module-level open-item count for the sidebar badge, shared by the sidebar
 * entry button. Polls the host `/kanban/counts` endpoint for one workspace and
 * exposes a bare observable pair (subscribe/getSnapshot) for
 * useSyncExternalStore — same pattern as board-state.ts.
 */

const listeners = new Set<() => void>()
let counts: { open: number } = { open: 0 }
let pollTimer: ReturnType<typeof setInterval> | null = null

/** Subscribe to count changes; returns an unsubscribe. */
export function subscribeCounts(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Current open-item count snapshot. */
export function getCountsSnapshot(): { open: number } {
  return counts
}

/** Fetch the open-item count for one workspace and publish it. */
export async function refreshCounts(cwd: string): Promise<void> {
  try {
    const response = await fetch(`/kanban/counts?cwd=${encodeURIComponent(cwd)}`)
    const body = await response.json() as { ok: boolean; open?: number }
    if (response.ok && body.ok === true && typeof body.open === 'number') {
      counts = { open: body.open }
      for (const fn of listeners) fn()
    }
  } catch {
    // Poll failures are silent; the badge just keeps its last value.
  }
}

/** The resolve function of the active poll (undefined before start). */
let latestResolveCwd: (() => string | undefined) | undefined

/**
 * Start polling. `resolveCwd` is called on each tick to find the current
 * workspace (e.g. from the current session), so the badge follows the active
 * workspace automatically. Refreshes immediately, then every interval.
 * Returns a stop function.
 */
export function startCountsPolling(resolveCwd: () => string | undefined, intervalMs = 30000): () => void {
  if (pollTimer !== null) return () => stopCountsPolling()
  latestResolveCwd = resolveCwd
  const tick = (): void => {
    const cwd = latestResolveCwd?.()
    if (cwd !== undefined && cwd !== '') void refreshCounts(cwd)
  }
  tick()
  pollTimer = setInterval(tick, intervalMs)
  return () => stopCountsPolling()
}

/**
 * Immediately re-resolve and refresh the count (used when the workspace feed
 * changes, so the badge appears as soon as data is ready instead of waiting
 * for the next poll interval).
 */
export function triggerCountsPoll(): void {
  const cwd = latestResolveCwd?.()
  if (cwd !== undefined && cwd !== '') void refreshCounts(cwd)
}

/** Stop polling; keeps the last published count. */
export function stopCountsPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  latestResolveCwd = undefined
}
