/**
 * The full-screen kanban board page (external plugin).
 *
 * Reads the workspace's KANBAN.json through the host webServer route
 * (GET/POST /kanban/api) and renders three columns (todo / in_progress / done)
 * with per-card status moves, delete, and an add composer. Pure presentation:
 * every read/write flows through the injected api callbacks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BoardKey } from './locales.ts'

/** One card as served by the host route. */
export interface BoardCardView {
  id: string
  title: string
  description?: string
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
}

/** Wire mutation request body shared by every POST op. */
export interface BoardMutationBody {
  cwd: string
  op: 'add' | 'update' | 'remove'
  id?: string
  title?: string
  description?: string
  status?: BoardCardView['status']
  tags?: string[]
}

/** Injected api face of the board page (over fetch /kanban/api). */
export interface BoardApi {
  /** GET the board for a workspace. */
  get: (cwd: string) => Promise<BoardViewPayload>
  /** POST one mutation and resolve with the fresh board. */
  mutate: (body: BoardMutationBody) => Promise<BoardViewPayload>
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

/** The board page component (rendered inside the shell.overlay seat). */
export function BoardPage({ api, workspace, onClose, t }: BoardPageProps) {
  const [cards, setCards] = useState<BoardCardView[]>([])
  const [path, setPath] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDescription, setDraftDescription] = useState('')

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

  const applyMutation = useCallback(async (body: BoardMutationBody): Promise<void> => {
    if (cwd === undefined) return
    setError(undefined)
    try {
      const board = await api.mutate({ ...body, cwd })
      setCards(sortCards(board.cards))
      setPath(board.path)
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
      ...draftDescription.trim() !== '' ? { description: draftDescription.trim() } : {},
    })
    setDraftTitle('')
    setDraftDescription('')
  }, [applyMutation, cwd, draftTitle, draftDescription])

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
        {loading
          ? <p className="kb-loading">{t('loading')}</p>
          : (
            <>
              <div className="kb-columns">
                {STATUSES.map(status => (
                  <section key={status} className="kb-column" data-status={status}>
                    <div className="kb-column-head">
                      <span className={`kb-dot kb-dot-${status}`} />
                      <h3 className="kb-column-title">{t(status === 'todo' ? 'statusTodo' : status === 'in_progress' ? 'statusInProgress' : 'statusDone')}</h3>
                      <span className="kb-column-count">{t('counts', { n: String(grouped[status].length) })}</span>
                    </div>
                    {grouped[status].map(card => (
                      <article key={card.id} className="kb-card" data-card-id={card.id}>
                        <h4 className="kb-card-title">{card.title}</h4>
                        {card.description !== undefined && <p className="kb-card-desc">{card.description}</p>}
                        {card.tags.length > 0 && (
                          <div className="kb-card-meta">
                            {card.tags.map(tag => <span key={tag} className="kb-tag">#{tag}</span>)}
                          </div>
                        )}
                        <div className="kb-card-actions">
                          <select
                            className="kb-status-select"
                            aria-label={t('statusTooltip')}
                            value={card.status}
                            onChange={event => moveCard(card.id, event.target.value as BoardCardView['status'])}
                          >
                            {STATUSES.map(option => (
                              <option key={option} value={option}>
                                {t(option === 'todo' ? 'statusTodo' : option === 'in_progress' ? 'statusInProgress' : 'statusDone')}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="kb-mini-btn kb-mini-btn-danger"
                            onClick={() => removeCard(card.id)}
                          >
                            {t('remove')}
                          </button>
                        </div>
                      </article>
                    ))}
                  </section>
                ))}
              </div>
              {cards.length === 0 && <p className="kb-empty">{t('empty')}</p>}
              <div className="kb-composer">
                <div className="kb-composer-row">
                  <input
                    className="kb-input"
                    value={draftTitle}
                    placeholder={t('addPlaceholder')}
                    onChange={event => setDraftTitle(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') addCard() }}
                  />
                  <button type="button" className="kb-primary-btn" disabled={draftTitle.trim() === ''} onClick={addCard}>
                    {t('add')}
                  </button>
                </div>
                <input
                  className="kb-input"
                  value={draftDescription}
                  placeholder={t('addDescriptionPlaceholder')}
                  onChange={event => setDraftDescription(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Enter' && draftTitle.trim() !== '') addCard() }}
                />
              </div>
            </>
          )}
      </div>
    </div>
  )
}

/** Shared header strip of the overlay. */
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
        <button type="button" className="kb-icon-btn" onClick={props.onRefresh}>{props.t('refresh')}</button>
      )}
      <button type="button" className="kb-icon-btn" onClick={props.onClose}>{props.t('close')}</button>
    </header>
  )
}
