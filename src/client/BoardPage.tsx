/**
 * The full-screen kanban board page (external plugin).
 *
 * Reads the workspace's KANBAN.json through the host webServer route
 * (GET/POST /kanban/api) and renders three columns (todo / in_progress / done)
 * with per-card status moves, delete, and an add composer. Interactive controls
 * use @deepseek-ai/dsh-client-ui-primitives (Button, Input, Menu, Pill, icons)
 * so the page matches the native DSH look; only layout lives in the plugin's
 * own token-based styles.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconGoalOutline16,
  IconInspectOutline12,
  IconListPenOutline16,
  IconPlusOutline16,
  IconQueueOutline14,
  IconRefreshOutline16,
  IconThinkOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  Input,
  Menu,
  Modal,
  Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardKey } from './locales.ts'

/** One card as served by the host route. */
export interface BoardCardView {
  id: string
  title: string
  description?: string
  summary?: string
  rationale?: string
  rejected?: string
  sourceSessionId?: string
  status: 'todo' | 'in_progress' | 'done'
  tags: string[]
  createdAt: number
  updatedAt: number
}

/** The full board payload returned by GET/POST /kanban/api. */
export interface BoardViewPayload {
  path: string
  cards: BoardCardView[]
  counts: { todo: number; inProgress: number; done: number }
  archived?: { count: number; path: string }
}

/** Wire mutation request body shared by every POST op. */
export interface BoardMutationBody {
  cwd: string
  op: 'add' | 'update' | 'remove'
  id?: string
  title?: string
  description?: string
  summary?: string
  rationale?: string
  rejected?: string
  status?: BoardCardView['status']
  tags?: string[]
}

/** One mutation without the workspace root; `cwd` is added at send time. */
export type BoardMutation = Omit<BoardMutationBody, 'cwd'>

/** Injected api face of the board page (over fetch /kanban/api). */
export interface BoardApi {
  /** GET the board for a workspace. */
  get: (cwd: string) => Promise<BoardViewPayload>
  /** POST one mutation and resolve with the fresh board. */
  mutate: (body: BoardMutationBody) => Promise<BoardViewPayload>
  /** GET the effective Agent Note spec for a workspace. */
  getSpec: (cwd: string) => Promise<NoteSpecView>
  /** POST spec overrides for a workspace. */
  setSpec: (cwd: string, body: NoteSpecMutation) => Promise<NoteSpecView>
}

/** The effective Agent Note spec as served by the host. */
export interface NoteSpecView {
  specVersion: number
  pluginSpecVersion: number
  noteClasses: string[]
  noteFormat: string
  nonTrivialDefinition: string
  hasOverrides: boolean
  overridesPath: string
}

/** One spec override mutation. */
export interface NoteSpecMutation {
  noteClasses?: string[]
  noteFormat?: string
  nonTrivialDefinition?: string
  acknowledgeSpecVersion?: number
}

/** The resolved workspace for this board view. */
export interface BoardWorkspace {
  /** Stable workspace id (dsh WorkspaceId). */
  workspaceId: string
  /** Absolute workspace root where KANBAN.json lives. */
  cwd: string
  /** Short display title (path basename). */
  title: string
}

/** Props delivered by the slot outlet: the api + workspace resolve + copy. */
export interface BoardPageProps {
  api: BoardApi
  /** The initially selected workspace (current session's workspace, if any). */
  workspace: BoardWorkspace | undefined
  /** Every workspace the user can switch the board to. */
  workspaces: readonly BoardWorkspace[]
  onClose: () => void
  t: (key: BoardKey, params?: Record<string, string>) => string
  /** Jump to the session that created a card (locate the handling session). */
  openSession?: (sessionId: string) => void
}

const STATUSES = ['todo', 'in_progress', 'done'] as const

/** Sort cards so done trails the open ones, and newest first within a status. */
function sortCards(cards: readonly BoardCardView[]): BoardCardView[] {
  return [...cards].sort((left, right) => {
    const order = { todo: 0, in_progress: 1, done: 2 } as const
    const d = order[left.status] - order[right.status]
    if (d !== 0) return d
    return right.createdAt - left.createdAt
  })
}

/** Status label for a board status (locale-aware). */
function statusLabel(status: BoardCardView['status'], t: BoardPageProps['t']): string {
  if (status === 'todo') return t('statusTodo')
  if (status === 'in_progress') return t('statusInProgress')
  return t('statusDone')
}

/** Compact local timestamp (YYYY-MM-DD HH:mm) for card meta lines. */
function formatTime(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The three Agent-Note-style what/why/rejected field names. */
type CardQualityField = 'summary' | 'rationale' | 'rejected'

/**
 * Which of the three what/why/rejected fields a card is missing — a local
 * mirror of the host's missingCardFields (kept here so the client bundle never
 * imports the node-side board-core): every card needs rationale (why); a done
 * card must carry all three so the next session can pick it up without asking.
 */
function missingCardFields(card: BoardCardView): CardQualityField[] {
  const missing: CardQualityField[] = []
  if (card.rationale === undefined || card.rationale.trim() === '') missing.push('rationale')
  if (card.status === 'done') {
    if (card.summary === undefined || card.summary.trim() === '') missing.push('summary')
    if (card.rejected === undefined || card.rejected.trim() === '') missing.push('rejected')
  }
  return missing
}

/** Localized field label for a quality-field name. */
function qualityFieldLabel(field: CardQualityField, t: BoardPageProps['t']): string {
  if (field === 'summary') return t('fieldSummary')
  if (field === 'rationale') return t('fieldRationale')
  return t('fieldRejected')
}

/** Second-resolution timestamp for the header's live auto-refresh indicator. */
function formatTimeWithSeconds(epochMs: number): string {
  const date = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${formatTime(epochMs)}:${pad(date.getSeconds())}`
}

/** The board page component (rendered inside the shell.overlay seat). */
export function BoardPage({ api, workspace, workspaces, onClose, t, openSession }: BoardPageProps) {
  const [cards, setCards] = useState<BoardCardView[]>([])
  const [path, setPath] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [lastUpdated, setLastUpdated] = useState<number | undefined>(undefined)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSummary, setDraftSummary] = useState('')
  const [draftRationale, setDraftRationale] = useState('')
  const [draftRejected, setDraftRejected] = useState('')
  const [archivedNotice, setArchivedNotice] = useState<{ count: number; path: string } | undefined>(undefined)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  // The selected workspace: starts at the current session's workspace, and the
  // user can switch to any registered workspace.
  const [selectedWorkspace, setSelectedWorkspace] = useState<BoardWorkspace | undefined>(workspace)
  // Content signature of the last rendered board (sorted cards serialized).
  // The background poll skips setState entirely when it matches, so an
  // unchanged board leaves the DOM — and the user's scroll position — intact.
  const lastSignature = useRef<string | null>(null)

  const cwd = selectedWorkspace?.cwd

  const refresh = useCallback(async (opts?: { silent?: boolean }): Promise<void> => {
    if (cwd === undefined) return
    const silent = opts?.silent ?? false
    if (!silent) {
      setLoading(true)
      setError(undefined)
    }
    try {
      const board = await api.get(cwd)
      const sorted = sortCards(board.cards)
      const signature = JSON.stringify(sorted)
      // Every successful fetch (silent or not) marks the header "auto-refreshed
      // at …" so the poll's liveness is visible without a manual refresh.
      setLastUpdated(Date.now())
      // A silent poll that sees no change must not touch the card state: even
      // with stable keys, swapping the array reference plus a loading flash
      // would churn the list DOM and drop the reading position mid-scroll.
      // Cards are memoized, so an unchanged poll re-renders only the header.
      if (silent && lastSignature.current === signature) return
      lastSignature.current = signature
      setCards(sorted)
      setPath(board.path)
    } catch (cause) {
      // Silent failures keep the current view — a stale board beats wiping
      // the cards the user is reading because one background poll hiccuped.
      if (!silent) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [api, cwd])

  // (Re)load whenever the workspace changes; the page mounts per open.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-refresh while open: the model or another session may write the board
  // at any time. Runs silently — the signature diff above skips setState when
  // nothing changed, so this never disturbs what the user is reading.
  useEffect(() => {
    const timer = setInterval(() => { void refresh({ silent: true }) }, 15000)
    return () => clearInterval(timer)
  }, [refresh])

  const applyMutation = useCallback(async (body: BoardMutation): Promise<void> => {
    if (cwd === undefined) return
    setError(undefined)
    try {
      const board = await api.mutate({ ...body, cwd })
      setCards(sortCards(board.cards))
      setPath(board.path)
      setArchivedNotice(board.archived)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, cwd])

  const addCard = useCallback((): void => {
    const title = draftTitle.trim()
    if (title === '' || cwd === undefined) return
    void applyMutation({
      op: 'add',
      title,
      ...draftSummary.trim() !== '' ? { summary: draftSummary.trim() } : {},
      ...draftRationale.trim() !== '' ? { rationale: draftRationale.trim() } : {},
      ...draftRejected.trim() !== '' ? { rejected: draftRejected.trim() } : {},
    })
    setDraftTitle('')
    setDraftSummary('')
    setDraftRationale('')
    setDraftRejected('')
  }, [applyMutation, cwd, draftTitle, draftSummary, draftRationale, draftRejected])

  const moveCard = useCallback((id: string, status: BoardCardView['status']): void => {
    void applyMutation({ op: 'update', id, status })
  }, [applyMutation])

  const removeCard = useCallback((id: string): void => {
    void applyMutation({ op: 'remove', id })
  }, [applyMutation])

  const grouped = useMemo(() => {
    const groups: Record<BoardCardView['status'], BoardCardView[]> = { todo: [], in_progress: [], done: [] }
    for (const card of cards) groups[card.status].push(card)
    return groups
  }, [cards])

  // No workspace selected yet — if any are registered, let the user pick one;
  // otherwise show the empty hint.
  if (selectedWorkspace === undefined) {
    return (
      <div className="kb-overlay">
        <BoardHeader onClose={onClose} t={t} />
        <div className="kb-body">
          {workspaces.length > 0 ? (
            <WorkspacePicker
              workspaces={workspaces}
              selected={undefined}
              open={workspacePickerOpen}
              onToggle={() => setWorkspacePickerOpen(v => !v)}
              onSelect={ws => { setSelectedWorkspace(ws); setWorkspacePickerOpen(false) }}
              t={t}
            />
          ) : (
            <p className="kb-empty">{t('noWorkspace')}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="kb-overlay" data-testid="kanban-page">
      <BoardHeader onClose={onClose} t={t} path={path} lastUpdated={lastUpdated} onRefresh={() => { void refresh() }} />
      <div className="kb-body">
        {workspaces.length > 0 && (
          <WorkspacePicker
            workspaces={workspaces}
            selected={selectedWorkspace}
            open={workspacePickerOpen}
            onToggle={() => setWorkspacePickerOpen(v => !v)}
            onSelect={ws => { setSelectedWorkspace(ws); setWorkspacePickerOpen(false) }}
            t={t}
          />
        )}
        {error !== undefined && <p className="kb-error">{error}</p>}
        {archivedNotice !== undefined && (
          <p className="kb-archived">
            {t('archivedNotice', { count: String(archivedNotice.count), path: archivedNotice.path })}
          </p>
        )}
        {loading
          ? <p className="kb-loading">{t('loading')}</p>
          : (
            <>
              <div className="kb-columns">
                {STATUSES.map(status => (
                  <section key={status} className="kb-column" data-status={status}>
                    <div className="kb-column-head">
                      <span className={`kb-dot kb-dot-${status}`} />
                      <h3 className="kb-column-title">{statusLabel(status, t)}</h3>
                      <span className="kb-column-count">{t('counts', { n: String(grouped[status].length) })}</span>
                    </div>
                    <div className="kb-column-cards">
                      {grouped[status].map(card => (
                        <Card
                          key={card.id}
                          card={card}
                          t={t}
                          onMove={moveCard}
                          onRemove={removeCard}
                          onOpenSession={openSession}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              {cards.length === 0 && <p className="kb-empty">{t('empty')}</p>}
              <div className="kb-composer">
                <div className="kb-composer-row">
                  <Input
                    className="kb-composer-field"
                    value={draftTitle}
                    placeholder={t('addPlaceholder')}
                    onChange={event => setDraftTitle(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') addCard() }}
                  />
                  <Button
                    variant="primary"
                    size="md"
                    icon={<IconPlusOutline16 />}
                    disabled={draftTitle.trim() === ''}
                    onClick={addCard}
                  >
                    {t('add')}
                  </Button>
                </div>
                <div className="kb-composer-fields">
                  <label className="kb-composer-field-col">
                    <span className="kb-composer-field-label">{t('fieldSummary')}</span>
                    <textarea
                      className="kb-composer-field-input"
                      rows={3}
                      value={draftSummary}
                      placeholder={t('addSummaryPlaceholder')}
                      onChange={event => setDraftSummary(event.target.value)}
                    />
                  </label>
                  <label className="kb-composer-field-col">
                    <span className="kb-composer-field-label">{t('fieldRationale')}</span>
                    <textarea
                      className="kb-composer-field-input"
                      rows={3}
                      value={draftRationale}
                      placeholder={t('addRationalePlaceholder')}
                      onChange={event => setDraftRationale(event.target.value)}
                    />
                  </label>
                  <label className="kb-composer-field-col">
                    <span className="kb-composer-field-label">{t('fieldRejected')}</span>
                    <textarea
                      className="kb-composer-field-input"
                      rows={3}
                      value={draftRejected}
                      placeholder={t('addRejectedPlaceholder')}
                      onChange={event => setDraftRejected(event.target.value)}
                    />
                  </label>
                </div>
              </div>
              {cwd !== undefined && <NoteSpecEditor api={api} cwd={cwd} t={t} />}
            </>
          )}
      </div>
    </div>
  )
}

/** The Agent Note spec editor: editable overrides + upstream source + update warning. */
function NoteSpecEditor(props: { api: BoardApi; cwd: string; t: BoardPageProps['t'] }) {
  const { api, cwd, t } = props
  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState<NoteSpecView | undefined>(undefined)
  const [classesDraft, setClassesDraft] = useState('')
  const [formatDraft, setFormatDraft] = useState('')
  const [definitionDraft, setDefinitionDraft] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = useCallback(async (): Promise<void> => {
    try {
      const view = await api.getSpec(cwd)
      setSpec(view)
      setClassesDraft(view.noteClasses.join(', '))
      setFormatDraft(view.noteFormat)
      setDefinitionDraft(view.nonTrivialDefinition)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, cwd])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const save = useCallback(async (): Promise<void> => {
    setError(undefined)
    setSaved(false)
    try {
      const classes = classesDraft.split(',').map(s => s.trim()).filter(s => s !== '')
      const view = await api.setSpec(cwd, {
        noteClasses: classes,
        noteFormat: formatDraft,
        nonTrivialDefinition: definitionDraft,
        acknowledgeSpecVersion: spec?.pluginSpecVersion,
      })
      setSpec(view)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, cwd, classesDraft, formatDraft, definitionDraft, spec?.pluginSpecVersion])

  const reset = useCallback(async (): Promise<void> => {
    setError(undefined)
    setSaved(false)
    try {
      // Empty overrides = defaults; acknowledge current plugin version.
      const view = await api.setSpec(cwd, {
        noteClasses: [],
        noteFormat: '',
        nonTrivialDefinition: '',
        acknowledgeSpecVersion: spec?.pluginSpecVersion,
      })
      setSpec(view)
      setClassesDraft(view.noteClasses.join(', '))
      setFormatDraft(view.noteFormat)
      setDefinitionDraft(view.nonTrivialDefinition)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api, cwd, spec?.pluginSpecVersion])

  const needsUpdateWarning = spec !== undefined
    && spec.hasOverrides
    && spec.specVersion !== spec.pluginSpecVersion

  return (
    <section className="kb-spec">
      <button type="button" className="kb-spec-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span>{t('specTitle')}</span>
        {spec !== undefined && spec.hasOverrides && <span className="kb-spec-active">{t('specOverrideActive')}</span>}
      </button>
      {open && (
        <div className="kb-spec-body">
          {needsUpdateWarning && spec !== undefined && (
            <p className="kb-spec-warning">{t('specUpdateWarning', { plugin: String(spec.pluginSpecVersion), current: String(spec.specVersion) })}</p>
          )}
          <p className="kb-spec-intro">{t('specIntro')}</p>
          <label className="kb-spec-label">
            {t('specClassesLabel')}
            <textarea
              className="kb-spec-input"
              rows={2}
              value={classesDraft}
              onChange={event => setClassesDraft(event.target.value)}
            />
            <span className="kb-spec-source">{t('specClassesSource')}</span>
          </label>
          <label className="kb-spec-label">
            {t('specFormatLabel')}
            <textarea
              className="kb-spec-input kb-spec-monospace"
              rows={8}
              value={formatDraft}
              onChange={event => setFormatDraft(event.target.value)}
            />
            <span className="kb-spec-source">{t('specFormatSource')}</span>
          </label>
          <label className="kb-spec-label">
            {t('specDefinitionLabel')}
            <textarea
              className="kb-spec-input"
              rows={4}
              value={definitionDraft}
              onChange={event => setDefinitionDraft(event.target.value)}
            />
            <span className="kb-spec-source">{t('specDefinitionSource')}</span>
          </label>
          {error !== undefined && <p className="kb-error">{error}</p>}
          {saved && <p className="kb-spec-saved">{t('specSaved')}</p>}
          <div className="kb-spec-actions">
            <Button variant="primary" size="sm" onClick={() => { void save() }}>{t('specSave')}</Button>
            <Button variant="ghost" size="sm" onClick={() => { void reset() }}>{t('specReset')}</Button>
          </div>
          {spec !== undefined && <p className="kb-spec-source">{t('specOverridesFile', { path: spec.overridesPath })}</p>}
        </div>
      )}
    </section>
  )
}

/** Workspace switcher: a Menu listing every registered workspace, with the current one highlighted. */
function WorkspacePicker(props: {
  workspaces: readonly BoardWorkspace[]
  selected: BoardWorkspace | undefined
  open: boolean
  onToggle: () => void
  onSelect: (ws: BoardWorkspace) => void
  t: BoardPageProps['t']
}) {
  const { workspaces, selected, open, onToggle, onSelect, t } = props
  // Menu renders its own check for selectedId — no per-item icon here, or the
  // selected row would show two checks (ours + the built-in one).
  const items = workspaces.map(ws => ({
    id: ws.workspaceId,
    label: ws.title,
  }))
  return (
    <Menu
      open={open}
      onClose={onToggle}
      items={items}
      selectedId={selected?.workspaceId}
      onSelect={(id) => {
        const ws = workspaces.find(w => w.workspaceId === id)
        // The parent onSelect closes the picker; do not also toggle here or
        // the menu would flip straight back open.
        if (ws !== undefined) onSelect(ws)
      }}
      align="start"
      // Portal so the list is not clipped by the board body's scroll container.
      portal
      anchor={(
        <button
          type="button"
          className="kb-workspace-picker"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="kb-workspace-label">{t('workspaceLabel')}:</span>
          <span className="kb-workspace-trigger">
            {selected?.title ?? t('workspaceChoose')}
            <IconChevronDownOutline14 />
          </span>
        </button>
      )}
    />
  )
}

/** One card row: title, the what/why/rejected fields, tags, then an action row
 * (source session + status + delete pinned right). The title + description +
 * the three what/why/rejected fields form the clickable region that opens the
 * detail dialog; the action row is deliberately outside it. */
// Memoized so an unchanged background poll re-renders only the header (the
// card props are referentially stable when the cards array is untouched).
const Card = memo(function Card(props: {
  card: BoardCardView
  t: BoardPageProps['t']
  onMove: (id: string, status: BoardCardView['status']) => void
  onRemove: (id: string) => void
  onOpenSession?: (sessionId: string) => void
}) {
  const { card, t, onMove, onRemove, onOpenSession } = props
  const [statusOpen, setStatusOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  // Menu renders its own check for selectedId — no per-item icon here, or the
  // selected row would show two checks.
  const statusItems = STATUSES.map(status => ({
    id: status,
    label: statusLabel(status, t),
  }))
  const fields: Array<[string, string | undefined]> = [
    [t('fieldSummary'), card.summary],
    [t('fieldRationale'), card.rationale],
    [t('fieldRejected'), card.rejected],
  ]
  // Card completeness: every card needs why; a done card needs all three
  // what/why/rejected fields (same rule as the host's missingCardFields).
  const missing = missingCardFields(card)
  const openDetail = useCallback((): void => setDetailOpen(true), [])
  return (
    <article className="kb-card" data-card-id={card.id}>
      <div
        role="button"
        tabIndex={0}
        aria-label={t('detailHint')}
        aria-haspopup="dialog"
        className="kb-card-hit"
        onClick={openDetail}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openDetail()
          }
        }}
      >
        <h4 className="kb-card-title">
          <span className="kb-card-title-text">{card.title}</span>
          <IconInspectOutline12 className="kb-card-detail-icon" />
        </h4>
        {card.description !== undefined && <p className="kb-card-desc">{card.description}</p>}
        {fields.some(([, value]) => value !== undefined) && (
          <div className="kb-card-fields">
            {fields.map(([label, value]) => value !== undefined && value !== '' && (
              <p key={label} className="kb-card-field">
                <span className="kb-card-field-label">{label}:</span> {value}
              </p>
            ))}
          </div>
        )}
        {missing.length > 0 && (
          <p className="kb-card-missing">
            <IconWarningOutline16 />
            {t('missingFields', {
              fields: missing.map(field => qualityFieldLabel(field, t)).join('、'),
            })}
          </p>
        )}
      </div>
      <div className="kb-card-actions">
        {card.tags.length > 0 && (
          <div className="kb-card-meta">
            {card.tags.map(tag => <Pill key={tag} active>{tag}</Pill>)}
          </div>
        )}
        <div className="kb-card-row">
          {card.sourceSessionId !== undefined && onOpenSession !== undefined && (
            <button
              type="button"
              className="kb-source-btn"
              onClick={() => onOpenSession(card.sourceSessionId as string)}
            >
              <IconQueueOutline14 />
              <span>{t('sourceSession')}</span>
            </button>
          )}
          <Menu
            open={statusOpen}
            onClose={() => { setStatusOpen(false) }}
            items={statusItems}
            selectedId={card.status}
            onSelect={(id) => { onMove(card.id, id as BoardCardView['status']); setStatusOpen(false) }}
            align="start"
            // Portal: the card sits inside the scrolling column, so a plain
            // bottom-anchored list would be clipped by the column's overflow.
            // Portaling renders the list fixed over document.body instead.
            portal
            anchor={(
              <Button
                variant="outline"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={statusOpen}
                onClick={() => { setStatusOpen(v => !v) }}
              >
                {statusLabel(card.status, t)}
              </Button>
            )}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<IconTrashOutline16 />}
            aria-label={t('remove')}
            onClick={() => setConfirmDelete(true)}
            className="kb-trash-btn"
          />
        </div>
      </div>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('deleteTitle')}
        closeLabel={t('deleteCancel')}
        description={t('deleteConfirm', { title: card.title })}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
              {t('deleteCancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<IconTrashOutline16 />}
              onClick={() => {
                onRemove(card.id)
                setConfirmDelete(false)
              }}
            >
              {t('deleteConfirmAction')}
            </Button>
          </>
        )}
      />
      <CardDetail
        card={card}
        t={t}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onOpenSession={onOpenSession}
      />
    </article>
  )
})

/**
 * The card detail dialog: a reading-friendly, pre-formatted view of one card.
 * Shows the title with status/tags, then the description and each of the three
 * what/why/rejected fields as labeled sections with full (newline-preserving)
 * content, plus the source session and created/updated times. Headless modal —
 * the plugin owns its header chrome so the body can scroll independently.
 */
function CardDetail(props: {
  card: BoardCardView
  t: BoardPageProps['t']
  open: boolean
  onClose: () => void
  onOpenSession?: (sessionId: string) => void
}) {
  const { card, t, open, onClose, onOpenSession } = props
  const sections: Array<{ label: string; value?: string; icon: ReactNode }> = [
    { label: t('fieldSummary'), value: card.summary, icon: <IconGoalOutline16 /> },
    { label: t('fieldRationale'), value: card.rationale, icon: <IconThinkOutline16 /> },
    { label: t('fieldRejected'), value: card.rejected, icon: <IconWarningOutline16 /> },
  ]
  const present = sections.filter(section => section.value !== undefined && section.value !== '')
  const hasDescription = card.description !== undefined && card.description !== ''
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={card.title}
      // headless: the plugin owns the header chrome (incl. the close button) —
      // closeLabel is rejected by ModalProps when headless, and unused by the
      // headless render path anyway.
      headless
      className="kb-detail-modal"
    >
      <div className="kb-detail">
        <div className="kb-detail-head">
          <div className="kb-detail-head-text">
            <h2 className="kb-detail-title">{card.title}</h2>
            <div className="kb-detail-meta">
              <span className="kb-detail-status">
                <span className={`kb-dot kb-dot-${card.status}`} />
                {statusLabel(card.status, t)}
              </span>
              {card.tags.map(tag => <Pill key={tag} active>{tag}</Pill>)}
            </div>
          </div>
          <button type="button" className="kb-detail-close" aria-label={t('close')} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className="kb-detail-scroll">
          {hasDescription && (
            <section className="kb-detail-block">
              <div className="kb-detail-block-label"><IconListPenOutline16 />{t('fieldDescription')}</div>
              <p className="kb-detail-block-body">{card.description}</p>
            </section>
          )}
          {present.map(section => (
            <section key={section.label} className="kb-detail-block">
              <div className="kb-detail-block-label">{section.icon}{section.label}</div>
              <p className="kb-detail-block-body">{section.value}</p>
            </section>
          ))}
          {!hasDescription && present.length === 0 && (
            <p className="kb-detail-empty">{t('detailEmpty')}</p>
          )}
          <div className="kb-detail-foot">
            {card.sourceSessionId !== undefined && onOpenSession !== undefined && (
              <button
                type="button"
                className="kb-source-btn"
                onClick={() => onOpenSession(card.sourceSessionId as string)}
              >
                <IconQueueOutline14 />
                <span>{t('sourceSession')}</span>
              </button>
            )}
            <span className="kb-detail-times">
              {t('detailCreated', { time: formatTime(card.createdAt) })}
              {card.updatedAt !== card.createdAt && ` · ${t('detailUpdated', { time: formatTime(card.updatedAt) })}`}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/** Shared header strip of the overlay (native DSH ghost buttons). */
function BoardHeader(props: {
  onClose: () => void
  t: BoardPageProps['t']
  path?: string
  lastUpdated?: number
  onRefresh?: () => void
}) {
  return (
    <header className="kb-header">
      <div>
        <h2 className="kb-header-title">{props.t('title')}</h2>
        {props.path !== undefined && (
          <p className="kb-header-sub">
            {props.t('pathLabel')}: {props.path}
            {props.lastUpdated !== undefined && <> · {props.t('autoUpdatedAt', { time: formatTimeWithSeconds(props.lastUpdated) })}</>}
          </p>
        )}
      </div>
      <div className="kb-header-spacer" />
      {props.onRefresh !== undefined && (
        <Button variant="ghost" size="md" icon={<IconRefreshOutline16 />} onClick={props.onRefresh}>
          {props.t('refresh')}
        </Button>
      )}
      <Button variant="ghost" size="md" icon={<IconCloseOutline16 />} onClick={props.onClose}>
        {props.t('close')}
      </Button>
    </header>
  )
}
