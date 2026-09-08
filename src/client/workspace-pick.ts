/**
 * Most-recently-active workspace picker (pure, client-side).
 *
 * Mirrors the official ui-workspace derivation (navigation.ts `recentWorkspace`):
 * among the registered workspaces pick the one whose attached sessions have the
 * latest updatedAt; a workspace with no attached session falls back to its own
 * createdAt. DSH removed the WorkspaceSnapshot's `recentWorkspaceId` field, so a
 * structural read of it would silently yield undefined and pin the default to
 * the first workspace — this derivation is the replacement.
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