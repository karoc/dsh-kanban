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

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  IconCheckOutline16,
  IconCloseOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
  Input,
  Menu,
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
  /** Absolute workspace root where KANBAN.json lives. */
  cwd: string
  /** Short display title (path basename). */
  title: string
}

/** Props delivered by the slot outlet: the api + workspace resolve + copy. */
export interface BoardPageProps {
  api: BoardApi
  workspace: BoardWorkspace | undefined
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

/** The board page component (rendered inside the shell.overlay seat). */
export function BoardPage({ api, workspace, onClose, t, openSession }: BoardPageProps) {
  const [cards, setCards] = useState<BoardCardView[]>([])
  const [path, setPath] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSummary, setDraftSummary] = useState('')
  const [draftRationale, setDraftRationale] = useState('')
  const [draftRejected, setDraftRejected] = useState('')
  const [archivedNotice, setArchivedNotice] = useState<{ count: number; path: string } | undefined>(undefined)

  const cwd = workspace?.cwd

  const refresh = useCallback(async (): Promise<void> => {
    if (cwd === undefined) return
    setLoading(true)
    setError(undefined)
    try {
      const board = await api.get(cwd)
      setCards(sortCards(board.cards))
      setPath(board.path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [api, cwd])

  // (Re)load whenever the workspace changes; the page mounts per open.
  useEffect(() => {
    void refresh()
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

  if (workspace === undefined) {
    return (
      <div className="kb-overlay">
        <BoardHeader onClose={onClose} t={t} />
        <div className="kb-body">
          <p className="kb-empty">{t('noWorkspace')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="kb-overlay" data-testid="kanban-page">
      <BoardHeader onClose={onClose} t={t} path={path} onRefresh={() => { void refresh() }} />
      <div className="kb-body">
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

/** One card row: title, the what/why/rejected fields, tags, status Menu + delete. */
function Card(props: {
  card: BoardCardView
  t: BoardPageProps['t']
  onMove: (id: string, status: BoardCardView['status']) => void
  onRemove: (id: string) => void
  onOpenSession?: (sessionId: string) => void
}) {
  const { card, t, onMove, onRemove, onOpenSession } = props
  const [statusOpen, setStatusOpen] = useState(false)
  const statusItems = STATUSES.map(status => ({
    id: status,
    label: statusLabel(status, t),
    ...status === card.status ? { icon: <IconCheckOutline16 /> } : {},
  }))
  const fields: Array<[string, string | undefined]> = [
    [t('fieldSummary'), card.summary],
    [t('fieldRationale'), card.rationale],
    [t('fieldRejected'), card.rejected],
  ]
  return (
    <article className="kb-card" data-card-id={card.id}>
      <h4 className="kb-card-title">{card.title}</h4>
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
      {card.sourceSessionId !== undefined && onOpenSession !== undefined && (
        <div className="kb-card-meta">
          <button
            type="button"
            className="kb-source-btn"
            onClick={() => onOpenSession(card.sourceSessionId as string)}
          >
            {t('sourceSession')}
          </button>
        </div>
      )}
      {card.tags.length > 0 && (
        <div className="kb-card-meta">
          {card.tags.map(tag => <Pill key={tag} active>{tag}</Pill>)}
        </div>
      )}
      <div className="kb-card-actions">
        <Menu
          open={statusOpen}
          onClose={() => { setStatusOpen(false) }}
          items={statusItems}
          selectedId={card.status}
          onSelect={(id) => { onMove(card.id, id as BoardCardView['status']); setStatusOpen(false) }}
          align="start"
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
          onClick={() => onRemove(card.id)}
        />
      </div>
    </article>
  )
}

/** Shared header strip of the overlay (native DSH ghost buttons). */
function BoardHeader(props: {
  onClose: () => void
  t: (key: BoardKey) => string
  path?: string
  onRefresh?: () => void
}) {
  return (
    <header className="kb-header">
      <div>
        <h2 className="kb-header-title">{props.t('title')}</h2>
        {props.path !== undefined && <p className="kb-header-sub">{props.t('pathLabel')}: {props.path}</p>}
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
