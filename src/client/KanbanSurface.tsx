/**
 * Sidebar entry button and overlay wrapper for the kanban board page.
 *
 * Kept in a `.tsx` file so the browser bundle can parse JSX; the plugin entry
 * (src/client/index.ts) stays plain TypeScript and imports these. The sidebar
 * entry mirrors the Settings footer trigger (icon + label, left-aligned,
 * 34px compact row) so it lines up with the Settings entry below it.
 */

import { useSyncExternalStore } from 'react'
import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { BoardPage, type BoardApi, type BoardWorkspace } from './BoardPage.tsx'
import { getBoardOpen, subscribeBoard } from './board-state.ts'
import type { BoardKey } from './locales.ts'

/**
 * Sidebar footer entry button: icon + label, left-aligned, styled exactly
 * like the Settings trigger (34px compact row, 12px radius, 10px left pad)
 * so it sits flush with the Settings entry below it. The rail (collapsed)
 * state shows only the icon, like the other rail controls.
 */
export function SidebarKanbanButton(props: { onClick: () => void; t: () => string; wide?: boolean }) {
  const wide = props.wide ?? true
  return (
    <button
      type="button"
      className={wide ? 'kb-sidebar-trigger' : 'kb-sidebar-trigger kb-sidebar-trigger-rail'}
      aria-label={props.t()}
      onClick={props.onClick}
    >
      <IconChecklistOutline14 size={wide ? 16 : 18} />
      {wide && <span className="kb-sidebar-trigger-label">{props.t()}</span>}
    </button>
  )
}

/** Injected face of the overlay entry (workspace is resolved inside the component). */
export interface BoardOverlayInjected {
  api: BoardApi
  onClose: () => void
  t: (key: BoardKey, params?: Record<string, unknown>) => string
  openSession?: (sessionId: string) => void
}

/**
 * Build the full workspace list plus the default (current-session) workspace
 * from the framework seats. Default: the current session's cwd, then the most
 * recent workspace, then the first workspace. The list drives the board page's
 * workspace switcher.
 */
function resolveWorkspaces(
  sessionList: { byId?: Record<string, { cwd?: string }>; current?: string },
  workspaceList: { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string },
): { all: BoardWorkspace[]; current: BoardWorkspace | undefined } {
  const items = workspaceList.items ?? []
  const all = items.map(item => ({
    workspaceId: item.workspaceId,
    cwd: item.path,
    title: item.title ?? item.path,
  }))
  const current = sessionList.current
  if (current !== undefined) {
    const cwd = sessionList.byId?.[current]?.cwd
    if (cwd !== undefined && cwd !== '') {
      const base = cwd.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? cwd
      // Match the cwd to a registered workspace if possible (for a stable id).
      const match = all.find(ws => ws.cwd === cwd)
      return { all, current: match ?? { workspaceId: cwd, cwd, title: base } }
    }
  }
  const recentId = workspaceList.recentWorkspaceId
  const recent = all.find(ws => ws.workspaceId === recentId) ?? all[0]
  return { all, current: recent }
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
  const { all, current } = resolveWorkspaces(
    (props.useSessions?.((s: { byId?: Record<string, { cwd?: string }>; current?: string }) => s) as { byId?: Record<string, { cwd?: string }>; current?: string }) ?? {},
    (props.useWorkspaces?.((s: { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string }) => s) as { items?: ReadonlyArray<{ workspaceId: string; path: string; title?: string }>; recentWorkspaceId?: string }) ?? {},
  )
  if (!open) return null
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
