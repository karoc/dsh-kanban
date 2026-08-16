/** Copy dictionaries for the dsh-kanban board page. */

/** English strings (the key-set source of truth for this pair). */
export const en = {
  nav: 'Kanban',
  title: 'Kanban board',
  intro: 'Cross-session plans and todos, persisted to KANBAN.json at the workspace root.',
  pathLabel: 'Board file',
  close: 'Close',
  loading: 'Loading…',
  empty: 'No cards yet. Ask the model to board_add a plan step, or add one below.',
  addPlaceholder: 'New card title…',
  addDescriptionPlaceholder: 'Description (optional)…',
  add: 'Add',
  remove: 'Remove',
  statusTodo: 'To do',
  statusInProgress: 'In progress',
  statusDone: 'Done',
  statusTooltip: 'Move card',
  doneAction: 'Done',
  noWorkspace: 'No workspace selected. Open a session first.',
  refresh: 'Refresh',
  counts: '{n}',
}

/** The board page copy key set. */
export type BoardKey = keyof typeof en

/** Chinese strings (same keys as {@link en}). */
export const zh: { [Key in keyof typeof en]: string } = {
  nav: '看板',
  title: '看板',
  intro: '跨会话的计划与待办，持久化到工作区根目录的 KANBAN.json。',
  pathLabel: '看板文件',
  close: '关闭',
  loading: '加载中…',
  empty: '还没有卡片。可以让模型用 board_add 记录计划步骤，或在下方面板新增。',
  addPlaceholder: '新卡片标题…',
  addDescriptionPlaceholder: '描述（可选）…',
  add: '新增',
  remove: '删除',
  statusTodo: '待办',
  statusInProgress: '进行中',
  statusDone: '已完成',
  statusTooltip: '移动卡片',
  doneAction: '完成',
  noWorkspace: '尚未选择工作区。请先打开一个会话。',
  refresh: '刷新',
  counts: '{n}',
}
