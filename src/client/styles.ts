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
/* Open-item count badge on the sidebar entry (wide + rail states). */
.kb-badge {
  margin-left: auto;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-bg-base);
  font-size: 10px; line-height: 16px; font-weight: 600;
}
.kb-badge-rail {
  position: absolute;
  top: -2px; right: -2px;
  min-width: 14px; height: 14px;
  border-radius: 7px;
  font-size: 9px; line-height: 14px;
}
.kb-sidebar-trigger-rail { position: relative; }
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
/* Workspace switcher strip at the top of the board body: a clearly clickable
   grey capsule (hover darkens) so users can see it opens a menu. */
.kb-workspace-picker {
  display: inline-flex; align-items: center; gap: 8px;
  margin: 0 0 16px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
  transition: background 120ms ease;
}
.kb-workspace-picker:hover { background: var(--dsw-alias-interactive-bg-hover); }
.kb-workspace-label { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.kb-workspace-picker .kb-workspace-trigger {
  font-size: 13px; line-height: 18px;
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  display: inline-flex; align-items: center; gap: 6px;
}
.kb-workspace-trigger svg { flex: none; }
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
/* The card list under the column header: at most ~3.5 rows visible, then
   scrolls. The header stays fixed; only the cards area scrolls. */
.kb-column-cards {
  display: flex; flex-direction: column; gap: 10px;
  max-height: 350px; overflow-y: auto;
}
.kb-column-head { display: flex; align-items: center; gap: 8px; flex: none; }
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
/* The clickable content region (title + description + the three what/why/
   rejected fields) that opens the detail dialog: pointer cursor, hover tint,
   and a subtle "inspect" affordance beside the title. Keyboard reachable
   (role=button). The action row below is outside this region. */
.kb-card-hit {
  display: flex; flex-direction: column; gap: 6px;
  padding: 2px; margin: -2px;
  border-radius: 8px;
  cursor: pointer;
  outline: none;
  transition: background 120ms ease;
}
.kb-card-hit:hover,
.kb-card-hit:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover);
}
.kb-card-title {
  margin: 0; font-size: 13px; line-height: 18px;
  display: flex; align-items: baseline; gap: 6px;
}
.kb-card-title-text { flex: 1; min-width: 0; word-break: break-word; }
.kb-card-detail-icon {
  flex: none; align-self: center;
  color: var(--dsw-alias-label-tertiary);
  transition: color 120ms ease;
}
.kb-card-hit:hover .kb-card-detail-icon,
.kb-card-hit:focus-visible .kb-card-detail-icon {
  color: var(--dsw-alias-label-primary);
}
.kb-card-desc { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); word-break: break-word; }
.kb-card-fields { display: flex; flex-direction: column; gap: 4px; }
/* Each what/why/rejected field is clamped to at most two lines with an
   ellipsis (webkit-line-clamp); the full text lives in the detail dialog. */
.kb-card-field {
  margin: 0; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary); word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kb-card-field-label { color: var(--dsw-alias-label-tertiary); font-weight: 600; }
.kb-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
/* Card footer: tags on their own line, then one action row holding
   [source-session][status] ... [delete pinned right]. */
.kb-card-actions { display: flex; flex-direction: column; gap: 6px; }
.kb-card-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.kb-source-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 12px; line-height: 18px;
  cursor: pointer; white-space: nowrap;
}
.kb-source-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.kb-source-btn svg { flex: none; }
.kb-trash-btn { margin-left: auto; }
.kb-composer {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 12px; margin-top: 16px;
  background: var(--dsw-alias-bg-module-platform);
}
.kb-composer-row { display: flex; gap: 8px; align-items: center; }
.kb-composer-field { flex: 1; min-width: 0; }
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
  min-height: 108px;
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
.kb-archived {
  margin: 0 0 12px; padding: 8px 12px; font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l3); border-radius: 8px;
  background: var(--dsw-alias-bg-module);
  word-break: break-all;
}
/* Card detail dialog (headless Modal): wider than the 380px default, with a
   fixed head (title + status/tags + close) over an independently scrolling,
   pre-formatted body. Portaled to document.body, so scope under body. */
body .kb-detail-modal { width: min(560px, 100%); }
.kb-detail { display: flex; flex-direction: column; width: 100%; }
.kb-detail-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 22px 14px 14px 24px;
  flex: none;
}
.kb-detail-head-text {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 10px;
}
.kb-detail-title {
  margin: 0; font-size: 17px; line-height: 26px; font-weight: 600;
  color: var(--dsw-alias-label-primary);
  word-break: break-word; white-space: pre-wrap;
}
.kb-detail-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kb-detail-status {
  display: inline-flex; align-items: center; gap: 6px;
  height: 20px; padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform);
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.kb-detail-close {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  border: none; border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.kb-detail-close:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.kb-detail-scroll {
  display: flex; flex-direction: column; gap: 16px;
  overflow-y: auto;
  max-height: min(56vh, 520px);
  padding: 0 24px 8px;
}
.kb-detail-block { display: flex; flex-direction: column; gap: 6px; }
.kb-detail-block-label {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; line-height: 18px; font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}
.kb-detail-block-label svg { flex: none; color: var(--dsw-alias-label-secondary); }
/* Full text with preserved line breaks, on a soft panel for comfortable
   reading; taller line-height than the card preview. */
.kb-detail-block-body {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  background: var(--dsw-alias-bg-module);
  font-size: 13px; line-height: 22px;
  color: var(--dsw-alias-label-primary);
  white-space: pre-wrap; word-break: break-word;
}
.kb-detail-empty {
  margin: 0; padding: 20px; text-align: center;
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  border: 1px dashed var(--dsw-alias-border-l3); border-radius: 10px;
}
.kb-detail-foot {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-top: 2px; padding-top: 12px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.kb-detail-times {
  font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
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
