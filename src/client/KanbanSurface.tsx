/**
 * Sidebar global-panel glyph and the panel wrapper for the board page.
 *
 * Kept in a `.tsx` file so the browser bundle can parse JSX; the plugin entry
 * (src/client/index.ts) stays plain TypeScript and imports these. The board is
 * a DSH "global panel" (DSH ≥ 0.1.6): the sidebar renders the panel row — icon,
 * label, tooltip, selected tint — from the `sidebar.panellist` registration,
 * and the frame renders this file's page component in the `main` column while
 * that panel is selected. Nothing here draws its own button or overlay chrome.
 */

import { useSyncExternalStore } from 'react'
import { IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { BoardPage, type BoardApi, type BoardWorkspace } from './BoardPage.tsx'
import { getCountsSnapshot, subscribeCounts } from './board-counts.ts'
import { currentSessionId, recentWorkspaceId, type SessionListLike } from './workspace-pick.ts'
import type { BoardKey } from './locales.ts'

/** Props the sidebar hands a panel glyph (`PropsRuntime<'sidebar.panellist'>`). */
export interface PanelIconProps {
  /** Requested square edge in pixels (16 wide, 18 in the collapsed rail). */
  size: number
  /** Whether this panel is the selected one. */
  active: boolean
}

/**
 * Sidebar glyph for the board panel: the checklist icon at the size the
 * sidebar asks for, plus the open-item count badge (same count the old footer
 * entry showed, from the /kanban/counts poll).
 */
export function KanbanPanelIcon(props: PanelIconProps) {
  const { open } = useSyncExternalStore(subscribeCounts, getCountsSnapshot)
  return (
    <span className="kb-panel-icon">
      <IconChecklistOutlineRegular size={props.size} />
      {open > 0 && (
        <span className="kb-panel-badge" title={`${open} open`}>{open > 99 ? '99+' : String(open)}</span>
      )}
    </span>
  )
}

/** Injected face of the `main` panel entry (the workspace is resolved in the component). */
export interface BoardPanelInjected {
  api: BoardApi
  /** Leave the panel: select the Conversation again (`ctx.layout.selectPanel(null)`). */
  onClose: () => void
  t: (key: BoardKey, params?: Record<string, unknown>) => string
  openSession?: (sessionId: string) => void
}

/**
 * The `main` panel occupant: the frame renders it only while the board panel is
 * selected, so it needs no visibility gate of its own.
 */
export function KanbanPanel(props: BoardPanelInjected & RootStandardProps) {
  const { all, current } = resolveWorkspaces(
    (props.useSessions?.((s: SessionListLike) => s) as SessionListLike | undefined) ?? {},
    (props.useWorkspaces?.((s: WorkspacesSnapshot) => s) as WorkspacesSnapshot | undefined) ?? {},
  )
  return (
    <BoardPage
      api={props.api}
      workspace={current}
      workspaces={all}
      onClose={props.onClose}
      t={props.t}
      openSession={props.openSession}
    />
  )
}

/**
 * Build the full workspace list plus the default (current-session) workspace
 * from the framework seats. Default: the current session's cwd, then the most
 * recently active workspace, then the first workspace. The list drives the
 * board page's workspace switcher. The current Session is resolved through
 * {@link currentSessionId}, which covers both DSH selection eras (list-snapshot
 * `current` up to 0.1.5, main-view retention from 0.1.6-alpha.2 on).
 */
function resolveWorkspaces(
  sessionList: SessionListLike,
  workspaceList: { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string; sessionIds?: readonly string[]; createdAt?: string }> },
): { all: BoardWorkspace[]; current: BoardWorkspace | undefined } {
  const items = workspaceList.items ?? []
  const all = items.map(item => ({
    workspaceId: item.workspaceId,
    cwd: item.path,
    title: item.title ?? item.path,
  }))
  const current = currentSessionId(sessionList)
  if (current !== undefined) {
    const cwd = sessionList.byId?.[current]?.cwd
    if (cwd !== undefined && cwd !== '') {
      const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? cwd
      // Match the cwd to a registered workspace if possible (for a stable id).
      const match = all.find(ws => ws.cwd === cwd)
      return { all, current: match ?? { workspaceId: cwd, cwd, title: base } }
    }
  }
  const recentId = recentWorkspaceId(items, sessionList.byId)
  const recent = all.find(ws => ws.workspaceId === recentId) ?? all[0]
  return { all, current: recent }
}

/**
 * The framework standard props available to a root-scope slot entry: the
 * global useSessions / useWorkspaces selector hooks. Structural, so the
 * external bundle compiles without pulling the runtime's merged types. The
 * session snapshot type carries both selection eras (see workspace-pick.ts).
 */
type WorkspacesSnapshot = { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string; sessionIds?: readonly string[]; createdAt?: string }> }

interface RootStandardProps {
  useSessions?: (selector: (snapshot: SessionListLike) => unknown) => unknown
  useWorkspaces?: (selector: (snapshot: WorkspacesSnapshot) => unknown) => unknown
}
