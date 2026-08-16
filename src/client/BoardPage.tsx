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

/** Status label for a board status (locale-aware). */
function statusLabel(status: BoardCardView['status'], t: BoardPageProps['t']): string {
  if (status === 'todo') return t('statusTodo')
  if (status === 'in_progress') return t('statusInProgress')
  return t('statusDone')
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
                      <h3 className="kb-column-title">{statusLabel(status, t)}</h3>
                      <span className="kb-column-count">{t('counts', { n: String(grouped[status].length) })}</span>
                    </div>
                    {grouped[status].map(card => (
                      <Card
                        key={card.id}
                        card={card}
                        t={t}
                        onMove={moveCard}
                        onRemove={removeCard}
                      />
                    ))}
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
                <Input
                  className="kb-composer-field"
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

/** One card row: title, optional description, tags, and a status Menu + delete. */
function Card(props: {
  card: BoardCardView
  t: BoardPageProps['t']
  onMove: (id: string, status: BoardCardView['status']) => void
  onRemove: (id: string) => void
}) {
  const { card, t, onMove, onRemove } = props
  const [statusOpen, setStatusOpen] = useState(false)
  const statusItems = STATUSES.map(status => ({
    id: status,
    label: statusLabel(status, t),
    ...status === card.status ? { icon: <IconCheckOutline16 /> } : {},
  }))
  return (
    <article className="kb-card" data-card-id={card.id}>
      <h4 className="kb-card-title">{card.title}</h4>
      {card.description !== undefined && <p className="kb-card-desc">{card.description}</p>}
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
