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

/** Injected face of the overlay entry. */
export interface BoardOverlayInjected {
  api: BoardApi
  workspace: BoardWorkspace | undefined
  onClose: () => void
  t: (key: BoardKey, params?: Record<string, unknown>) => string
}

/** Overlay wrapper: renders the board page only while open. */
export function KanbanOverlay(props: BoardOverlayInjected) {
  const open = useSyncExternalStore(subscribeBoard, getBoardOpen)
  if (!open) return null
  return <BoardPage api={props.api} workspace={props.workspace} onClose={props.onClose} t={props.t} />
}
