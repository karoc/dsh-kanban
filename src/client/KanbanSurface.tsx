/**
 * Sidebar entry button and overlay wrapper for the kanban board page.
 *
 * Kept in a `.tsx` file so the browser bundle can parse JSX; the plugin entry
 * (src/client/index.ts) stays plain TypeScript and imports these.
 */

import { useSyncExternalStore } from 'react'
import { BoardPage, type BoardApi, type BoardWorkspace } from './BoardPage.tsx'
import { getBoardOpen, subscribeBoard } from './board-state.ts'
import type { BoardKey } from './locales.ts'

/** Sidebar footer entry button. */
export function SidebarKanbanButton(props: { onClick: () => void; t: () => string }) {
  return (
    <button type="button" className="kb-sidebar-btn" onClick={props.onClick}>
      {props.t()}
    </button>
  )
}

/** Injected face of the overlay entry (workspace is resolved inside the component). */
export interface BoardOverlayInjected {
  api: BoardApi
  onClose: () => void
  t: (key: BoardKey, params?: Record<string, unknown>) => string
}

/**
 * Resolve a workspace for the board from the framework seats. Prefers the
 * current session's cwd, then the most recent workspace, then the first
 * workspace.
 */
function resolveWorkspace(
  sessionList: { byId?: Record<string, { cwd?: string }>; current?: string },
  workspaceList: { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string },
): BoardWorkspace | undefined {
  const current = sessionList.current
  if (current !== undefined) {
    const cwd = sessionList.byId?.[current]?.cwd
    if (cwd !== undefined && cwd !== '') {
      const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? cwd
      return { cwd, title: base }
    }
  }
  const items = workspaceList.items ?? []
  const recentId = workspaceList.recentWorkspaceId
  const workspace = items.find(item => item.workspaceId === recentId) ?? items[0]
  if (workspace !== undefined) {
    return { cwd: workspace.path, title: workspace.title ?? workspace.path }
  }
  return undefined
}

/**
 * The framework standard props available to a root-scope slot entry: the
 * global useSessions / useWorkspaces selector hooks. Structural, so the
 * external bundle compiles without pulling the runtime's merged types.
 */
interface RootStandardProps {
  useSessions?: (selector: (snapshot: { byId?: Record<string, { cwd?: string }>; current?: string }) => unknown) => unknown
  useWorkspaces?: (selector: (snapshot: { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string }) => unknown) => unknown
}

/** Overlay wrapper: renders the board page only while open. */
export function KanbanOverlay(props: BoardOverlayInjected & RootStandardProps) {
  const open = useSyncExternalStore(subscribeBoard, getBoardOpen)
  const workspace = resolveWorkspace(
    (props.useSessions?.((s: { byId?: Record<string, { cwd?: string }>; current?: string }) => s) as { byId?: Record<string, { cwd?: string }>; current?: string }) ?? {},
    (props.useWorkspaces?.((s: { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string }) => s) as { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string }) ?? {},
  )
  if (!open) return null
  return <BoardPage api={props.api} workspace={workspace} onClose={props.onClose} t={props.t} />
}
