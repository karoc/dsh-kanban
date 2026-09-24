/**
 * Kanban board plugin (Smoothly Kanban / 思磨力看板), browser half (external
 * bundle, not part of the DSH repository). Registers a DSH global panel
 * (`sidebar.panellist` glyph + `main` occupant, DSH ≥ 0.1.6): the sidebar shows
 * the 「思磨力看板」 entry and the centre column renders the three-column board
 * page backed by the host webServer route (GET/POST /kanban/api, served by this
 * bundle's host half).
 *
 * The page resolves its workspace from the current session's cwd (falling
 * back to the most recent workspace path), so the KANBAN.json it reads is the
 * same file the model tools (board_list/board_add/board_update/board_remove)
 * write — cross-session by construction.
 */

import { useSyncExternalStore } from 'react'
// Canonical client-half context type: the removed dsh-client-runtime package
// no longer provides ClientContext; cordis Context is the client apply type
// (matches the built-in ui-* plugins).
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merges (the 'main' keyed slot, the
// 'sidebar.panellist' list and its owner props) plus the MainPanelId brand.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the renderer's Context merge (ctx.slots) — the successor
// of the removed dsh-client-web-react package.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BoardPage, type BoardApi, type BoardMutationBody, type BoardViewPayload, type NoteSpecMutation, type NoteSpecView } from './BoardPage.tsx'
import { startCountsPolling, triggerCountsPoll } from './board-counts.ts'
import { KanbanPanel, KanbanPanelIcon, type BoardPanelInjected } from './KanbanSurface.tsx'
import { currentSessionId, recentWorkspaceId, type RecentSessionMeta, type SessionListLike } from './workspace-pick.ts'
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

/**
 * Global-panel id: the sidebar entry's list id and the `main` slot's key must
 * be the same branded value (ui-sidebar resolves the row's label and the
 * centre column's occupant from it).
 */
const PANEL_ID = 'kanban' as MainPanelId

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
 * Browser plugin body: registers the sidebar entry and the global-panel page.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-kanban: copy dictionaries')

  const api = createBoardApi()
  // Translate supports (key, params?) — aligned with ui-slots' Translate type.
  const t = ctx.locale.bind(NS) as (key: BoardKey, params?: Record<string, unknown>) => string

  // Sidebar badge: poll the current workspace's open-item count so the
  // 「看板」 entry shows how many cards are open. The workspace source is the
  // CURRENT session's cwd (same rule the board page uses to pick its
  // workspace), falling back to the most-recently-active workspace derived
  // from the workspaces + sessions feeds (official ui-workspace semantics —
  // the WorkspaceSnapshot's old `recentWorkspaceId` field was removed, so a
  // structural read of it would silently pin the badge to the first
  // workspace). The current Session itself is resolved through
  // currentSessionId, which reads the 0.1.6-alpha.2 main-view retention signal
  // as well as the removed-in-0.1.6 list-snapshot `current` field. Also
  // subscribes to both the session list (what actually changes on a workspace
  // switch) and the workspace list so the badge follows the switch immediately
  // instead of after the next poll interval. Stops on plugin teardown.
  ctx.effect(() => {
    const stop = startCountsPolling(() => {
      const sessions = ctx.get('sessions') as
        | { list?: { getSnapshot: () => SessionListLike } }
        | undefined
      let sessionBy: Record<string, RecentSessionMeta> | undefined
      try {
        const sessionState = sessions?.list?.getSnapshot()
        const currentId = currentSessionId(sessionState)
        sessionBy = sessionState?.byId
        const currentCwd = currentId === undefined ? undefined : sessionState?.byId?.[currentId]?.cwd
        if (currentCwd !== undefined && currentCwd !== '') return currentCwd
      } catch {
        // Fall through to the workspace feed.
      }
      const workspaces = ctx.get('workspaces') as
        | { list?: { getSnapshot: () => { items?: ReadonlyArray<{ workspaceId: string; path: string; sessionIds?: readonly string[]; createdAt?: string }> } } }
        | undefined
      try {
        const state = workspaces?.list?.getSnapshot()
        const items = state?.items ?? []
        const recentId = recentWorkspaceId(items, sessionBy)
        const recent = items.find(item => item.workspaceId === recentId)
        return recent?.path ?? items[0]?.path
      } catch {
        return undefined
      }
    })
    const sessions = ctx.get('sessions') as
      | { list?: { subscribe: (fn: () => void) => () => void } }
      | undefined
    const workspaces = ctx.get('workspaces') as
      | { list?: { subscribe: (fn: () => void) => () => void } }
      | undefined
    const unsubscribeSessions = sessions?.list?.subscribe(triggerCountsPoll)
    const unsubscribeWorkspaces = workspaces?.list?.subscribe(triggerCountsPoll)
    return () => { stop(); unsubscribeSessions?.(); unsubscribeWorkspaces?.() }
  }, 'dsh-kanban: counts polling')

  // The board is a DSH global panel (0.1.6+): a `main`-slot occupant keyed by
  // the panel id, plus the sidebar glyph registered into `sidebar.panellist`.
  // The sidebar owns the row (button, label, tooltip, selected tint) and the
  // frame swaps the Conversation out for this panel — no overlay, no z-index
  // from our side. Both entries share the panel id, which is what links the
  // sidebar icon to the centre column.
  //
  // The workspace is resolved reactively inside the page component from the
  // framework useSessions/useWorkspaces seats (global standard props), so
  // opening the panel after sessions have loaded picks up the real workspace.
  const panelInjected = (): Omit<BoardPanelInjected, 'workspace'> => ({
    api,
    // Leaving the panel = selecting the Conversation again (null = no global
    // panel), the same action the sidebar's session rows perform.
    onClose: () => {
      const layout = ctx.get('layout') as { selectPanel?: (id: null) => void } | undefined
      layout?.selectPanel?.(null)
    },
    t,
    // Jump to the session that created a card (locate the handling session).
    openSession: (sessionId: string) => {
      const sessions = ctx.get('sessions') as { open: (id: string) => void } | undefined
      if (sessions === undefined) return
      const layout = ctx.get('layout') as { selectPanel?: (id: null) => void } | undefined
      layout?.selectPanel?.(null)
      sessions.open(sessionId)
    },
  })

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: panelInjected,
  }, KanbanPanel))

  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 10,
    label: () => t('nav'),
    locale: NS,
  }, KanbanPanelIcon))
}

