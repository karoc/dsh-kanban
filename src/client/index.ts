/**
 * Kanban board plugin, browser half (external bundle, not part of the DSH
 * repository). Registers a sidebar footer action ("看板") that opens a
 * full-screen three-column board page backed by the host webServer route
 * (GET/POST /kanban/api, served by this bundle's host half).
 *
 * The page resolves its workspace from the current session's cwd (falling
 * back to the most recent workspace path), so the KANBAN.json it reads is the
 * same file the model tools (board_list/board_add/board_update/board_remove)
 * write — cross-session by construction.
 */

import { useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merges (the 'sidebar.footer.action' and
// 'shell.overlay' entries) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BoardPage, type BoardApi, type BoardMutationBody, type BoardViewPayload, type NoteSpecMutation, type NoteSpecView } from './BoardPage.tsx'
import { startCountsPolling, triggerCountsPoll } from './board-counts.ts'
import { closeBoard, openBoard } from './board-state.ts'
import { KanbanOverlay, SidebarKanbanButton, type BoardOverlayInjected } from './KanbanSurface.tsx'
import { en, zh, type BoardKey } from './locales.ts'
// Side-effect import: injects the design-token styles at module evaluation.
import './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The kanban board page copy. */
    'dsh-kanban': BoardKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-kanban'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

/** Build the fetch-backed board api bound to this origin. */
function createBoardApi(): BoardApi {
  const endpoint = '/kanban/api'
  const specEndpoint = '/kanban/spec'
  const get = async (cwd: string): Promise<BoardViewPayload> => {
    const response = await fetch(`${endpoint}?cwd=${encodeURIComponent(cwd)}`)
    const body = await response.json() as { ok: boolean; error?: string } & Partial<BoardViewPayload>
    if (!response.ok || body.ok !== true || body.cards === undefined) {
      throw new Error(body.error ?? `kanban: GET failed with ${response.status}`)
    }
    return { path: body.path as string, cards: body.cards, counts: body.counts as BoardViewPayload['counts'] }
  }
  const mutate = async (payload: BoardMutationBody): Promise<BoardViewPayload> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json() as { ok: boolean; error?: string } & Partial<BoardViewPayload>
    if (!response.ok || body.ok !== true || body.cards === undefined) {
      throw new Error(body.error ?? `kanban: POST failed with ${response.status}`)
    }
    return { path: body.path as string, cards: body.cards, counts: body.counts as BoardViewPayload['counts'] }
  }
  const getSpec = async (cwd: string): Promise<NoteSpecView> => {
    const response = await fetch(`${specEndpoint}?cwd=${encodeURIComponent(cwd)}`)
    const body = await response.json() as { ok: boolean; error?: string } & Partial<NoteSpecView>
    if (!response.ok || body.ok !== true || body.specVersion === undefined) {
      throw new Error(body.error ?? `kanban: GET /kanban/spec failed with ${response.status}`)
    }
    return {
      specVersion: body.specVersion as number,
      pluginSpecVersion: body.pluginSpecVersion as number,
      noteClasses: body.noteClasses as string[],
      noteFormat: body.noteFormat as string,
      nonTrivialDefinition: body.nonTrivialDefinition as string,
      hasOverrides: body.hasOverrides as boolean,
      overridesPath: body.overridesPath as string,
    }
  }
  const setSpec = async (cwd: string, mutation: NoteSpecMutation): Promise<NoteSpecView> => {
    const response = await fetch(specEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd, ...mutation }),
    })
    const body = await response.json() as { ok: boolean; error?: string } & Partial<NoteSpecView>
    if (!response.ok || body.ok !== true || body.specVersion === undefined) {
      throw new Error(body.error ?? `kanban: POST /kanban/spec failed with ${response.status}`)
    }
    return {
      specVersion: body.specVersion as number,
      pluginSpecVersion: body.pluginSpecVersion as number,
      noteClasses: body.noteClasses as string[],
      noteFormat: body.noteFormat as string,
      nonTrivialDefinition: body.nonTrivialDefinition as string,
      hasOverrides: body.hasOverrides as boolean,
      overridesPath: body.overridesPath as string,
    }
  }
  return { get, mutate, getSpec, setSpec }
}

/**
 * Browser plugin body: registers the sidebar entry and the full-screen page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-kanban: copy dictionaries')

  const api = createBoardApi()
  // Translate supports (key, params?) — aligned with ui-slots' Translate type.
  const t = ctx.locale.bind(NS) as (key: BoardKey, params?: Record<string, unknown>) => string

  // Sidebar badge: poll the current workspace's open-item count so the
  // 「看板」 entry shows how many cards are open. Workspace source: the
  // workspaces feed's most-recent workspace (more reliable than the current
  // session, which can be undefined before a session is selected). Also
  // subscribes to workspace-list changes so the badge appears as soon as data
  // is ready (not after the first 30s poll). Stops on plugin teardown.
  ctx.effect(() => {
    const stop = startCountsPolling(() => {
      const workspaces = ctx.get('workspaces') as
        | { list?: { getSnapshot: () => { items?: ReadonlyArray<{ workspaceId: string; path: string }>; recentWorkspaceId?: string } } }
        | undefined
      try {
        const state = workspaces?.list?.getSnapshot()
        const items = state?.items ?? []
        const recent = items.find(item => item.workspaceId === state?.recentWorkspaceId)
        return recent?.path ?? items[0]?.path
      } catch {
        return undefined
      }
    })
    const workspaces = ctx.get('workspaces') as
      | { list?: { subscribe: (fn: () => void) => () => void } }
      | undefined
    const unsubscribe = workspaces?.list?.subscribe(triggerCountsPoll)
    return () => { stop(); unsubscribe?.() }
  }, 'dsh-kanban: counts polling')

  // Sidebar footer action: the "看板" entry that opens the page.
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'kanban',
    order: 10,
    locale: NS,
    inject: () => ({
      onClick: openBoard,
      t: () => t('nav'),
    }),
  }, SidebarKanbanButton))

  // Full-screen overlay: the board page while open, null otherwise. The
  // workspace is resolved reactively inside the component from the framework
  // useSessions/useWorkspaces seats (global standard props), so opening the
  // page after sessions have loaded picks up the real workspace.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'kanban',
    order: 10,
    locale: NS,
    inject: (): Omit<BoardOverlayInjected, 'workspace'> => ({
      api,
      onClose: closeBoard,
      t,
      // Jump to the session that created a card (locate the handling session).
      openSession: (sessionId: string) => {
        const sessions = ctx.get('sessions') as { open: (id: string) => void } | undefined
        if (sessions === undefined) return
        closeBoard()
        sessions.open(sessionId)
      },
    }),
  }, KanbanOverlay))
}

