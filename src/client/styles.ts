/**
 * Design-token styles for the kanban board page (external plugin, no CSS
 * modules available). Re-declared against the official `--dsw-alias-*`
 * semantic tokens, namespaced under `kb-` to avoid collisions. Tokens carry
 * no fallback because the host theme always defines them on the app root.
 *
 * Layout and structure only: interactive controls (buttons, inputs, menus)
 * come from @deepseek-ai/dsh-client-ui-primitives so they match the native
 * DSH look.
 */
export const KANBAN_STYLES = `
/* Sidebar footer trigger, mirroring the Settings trigger (34px compact row,
   12px radius, 10px left pad, icon + left-aligned label). */
.kb-sidebar-trigger {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 8px);
  height: 34px;
  margin: 4px -4px 4px;
  padding: 6px 2px 6px 10px;
  box-sizing: border-box;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
}
.kb-sidebar-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
/* Rail trigger: the same 36x36 circle box as the other rail controls. */
.kb-sidebar-trigger-rail {
  width: 36px;
  height: 36px;
  margin: 8px 0 10px;
  justify-content: center;
  gap: 0;
  padding: 0;
  border-radius: 50%;
}
.kb-sidebar-trigger-label {
  overflow: hidden;
  white-space: nowrap;
}
.kb-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
}
.kb-header {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  flex: none;
}
.kb-header-title { margin: 0; font-size: 16px; line-height: 24px; }
.kb-header-sub { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.kb-header-spacer { flex: 1; }
.kb-body { flex: 1; overflow: auto; padding: 20px; }
.kb-board-path {
  margin: 0 0 16px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, monospace);
  word-break: break-all;
}
.kb-columns {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px; align-items: start;
}
.kb-column {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 12px; min-height: 120px;
  background: var(--dsw-alias-bg-module-platform);
}
.kb-column-head { display: flex; align-items: center; gap: 8px; }
.kb-column-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; }
.kb-column-count {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.kb-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.kb-dot-todo { background: var(--dsw-alias-label-tertiary); }
.kb-dot-in_progress { background: var(--dsw-alias-brand-primary); }
.kb-dot-done { background: var(--dsw-alias-button-primary-fill); }
.kb-card {
  display: flex; flex-direction: column; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-base);
}
.kb-card-title { margin: 0; font-size: 13px; line-height: 18px; word-break: break-word; }
.kb-card-desc { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); word-break: break-word; }
.kb-card-fields { display: flex; flex-direction: column; gap: 4px; }
.kb-card-field { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); word-break: break-word; }
.kb-card-field-label { color: var(--dsw-alias-label-tertiary); font-weight: 600; }
.kb-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kb-card-actions { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.kb-composer-field { flex: 1; min-width: 0; }
.kb-composer {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 12px; margin-top: 16px;
  background: var(--dsw-alias-bg-module-platform);
}
.kb-composer-row { display: flex; gap: 8px; align-items: center; }
/* The three "what/why/rejected" inputs: one row, three equal columns — the
   same rhythm as the board column headers above. */
.kb-composer-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}
.kb-composer-field-col {
  display: flex; flex-direction: column; gap: 4px;
  min-width: 0;
}
.kb-composer-field-label {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
  font-weight: 600;
}
.kb-composer-field-input {
  flex: 1;
  min-height: 72px;
  box-sizing: border-box;
  resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 8px 10px;
  background: var(--dsw-alias-bg-input, transparent);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 18px;
}
.kb-composer-field-input:focus { outline: none; border-color: var(--dsw-alias-border-l3); }
.kb-spec {
  margin-top: 16px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform);
}
.kb-spec-toggle {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  width: 100%; padding: 10px 12px; border: none; background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; cursor: pointer;
}
.kb-spec-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
.kb-spec-active { color: var(--dsw-alias-button-primary-fill); font-size: 12px; }
.kb-spec-body { display: flex; flex-direction: column; gap: 12px; padding: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
.kb-spec-intro { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.kb-spec-warning {
  margin: 0; padding: 8px 10px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-interactive-bg-hover-danger);
  border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px;
  background: var(--dsw-alias-bg-module);
}
.kb-spec-label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.kb-spec-input {
  width: 100%; box-sizing: border-box; resize: vertical;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  padding: 8px 10px; background: var(--dsw-alias-bg-input, transparent);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px;
}
.kb-spec-input:focus { outline: none; border-color: var(--dsw-alias-border-l3); }
.kb-spec-monospace { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, monospace); font-size: 12px; }
.kb-spec-source { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); word-break: break-word; }
.kb-spec-saved { margin: 0; font-size: 12px; color: var(--dsw-alias-button-primary-fill); }
.kb-spec-actions { display: flex; gap: 8px; }
.kb-loading, .kb-empty, .kb-error {
  padding: 24px; text-align: center; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.kb-empty { border: 1px dashed var(--dsw-alias-border-l3); border-radius: 12px; }
.kb-error { color: var(--dsw-alias-interactive-bg-hover-danger); }
`

/**
 * Inject {@link KANBAN_STYLES} once, tagged by plugin id so re-evaluation
 * and repeated mounts stay idempotent (mirrors how the loader handles plugin
 * CSS — the same pattern dsh-model-reasoning uses).
 * @param pluginId - stable plugin id used as the style tag marker.
 */
export function injectKanbanStyles(pluginId: string): void {
  if (typeof document === 'undefined') return
  const selector = `style[data-dsh-plugin-css="${pluginId}"]`
  if (document.querySelector(selector) !== null) return
  const tag = document.createElement('style')
  tag.setAttribute('data-dsh-plugin-css', pluginId)
  tag.textContent = KANBAN_STYLES
  document.head.appendChild(tag)
}

// Inject at module evaluation rather than from an `apply` closure. The loader
// executes this factory after the DOM head exists (the same timing the loader
// uses for plugin CSS tags), and a module-top-level call is a preserved side
// effect: the whole module cannot be tree-shaken away leaving a dangling
// reference, which is what a closure-only use allowed rolldown to do.
injectKanbanStyles('dsh-kanban')
