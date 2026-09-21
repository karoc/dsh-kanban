/**
 * Current-session and most-recently-active workspace pickers (pure, client-side).
 *
 * `recentWorkspaceId` mirrors the official ui-workspace derivation
 * (navigation.ts `recentWorkspace`): among the registered workspaces pick the
 * one whose attached sessions have the latest updatedAt; a workspace with no
 * attached session falls back to its own createdAt. DSH removed the
 * WorkspaceSnapshot's `recentWorkspaceId` field, so a structural read of it
 * would silently yield undefined and pin the default to the first workspace —
 * this derivation is the replacement.
 *
 * `currentSessionId` mirrors how the shell itself answers "which Session is on
 * stage", because that answer moved too: up to DSH 0.1.5 the session list
 * snapshot carried `current` (the persisted selection), and 0.1.6-alpha.2
 * removed it — the selection now lives with the Session binding, and the only
 * public, structural signal left is main-view retention
 * (`summary.retainedBy.mainView > 0`), the exact predicate ui-workspace's tree,
 * ui-session's main binding and Settings all read. Reading only `current` on
 * 0.1.6+ silently yields undefined and degrades the board's default workspace
 * to the most-recent one; reading only retention breaks 0.1.2–0.1.5. Both are
 * read here, newest first.
 *
 * The types are structural subsets of the real WorkspaceView / SessionSummary,
 * so the browser bundle compiles without pulling the runtime's merged types;
 * the host-side spec (scripts/workspace-pick.spec.mjs) imports this module
 * directly with Node's type-stripping.
 */

export interface RecentWorkspaceItem {
  workspaceId: string
  sessionIds?: readonly string[]
  createdAt?: string
}

export interface RecentSessionMeta {
  updatedAt?: number
  /** Owning Working directory of the Session, when the host supplied one. */
  cwd?: string
  /**
   * Local ownership counts by consumer (DSH ≥ 0.1.6-alpha.2). The main view's
   * entry is positive exactly while that Session is the one on stage.
   */
  retainedBy?: Readonly<Partial<Record<string, number>>> | undefined
}

/** Structural subset of the shell's SessionListState (both selection eras). */
export interface SessionListLike {
  /** DSH ≤ 0.1.5: the persisted selection rode the list snapshot. */
  current?: string | undefined
  byId?: Record<string, RecentSessionMeta> | undefined
}

/**
 * Resolve the Session currently on stage (the main view's occupant), or
 * undefined when none is — a global panel is open, or the list is still empty.
 * @param sessions - the `useSessions`/`ctx.sessions.list` snapshot, or undefined when absent.
 * @returns the current session id, or undefined.
 */
export function currentSessionId(sessions: SessionListLike | undefined): string | undefined {
  if (sessions === undefined) return undefined
  const legacy = sessions.current
  if (typeof legacy === 'string' && legacy !== '') return legacy
  const byId = sessions.byId
  if (byId === undefined) return undefined
  for (const [sessionId, summary] of Object.entries(byId)) {
    if ((summary.retainedBy?.mainView ?? 0) > 0) return sessionId
  }
  return undefined
}

/** Pick the most-recently-active workspace id, or undefined when empty. */
export function recentWorkspaceId(
  items: readonly RecentWorkspaceItem[],
  byId: Record<string, RecentSessionMeta> | undefined,
): string | undefined {
  let selected: string | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of items) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds ?? []) {
      const session = byId?.[sessionId]
      if (session !== undefined && typeof session.updatedAt === 'number') {
        latest = Math.max(latest, session.updatedAt)
      }
    }
    if (latest === Number.NEGATIVE_INFINITY && workspace.createdAt !== undefined) {
      const parsed = Date.parse(workspace.createdAt)
      if (!Number.isNaN(parsed)) latest = parsed
    }
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}