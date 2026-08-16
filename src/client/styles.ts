/**
 * Design-token styles for the kanban board page (external plugin, no CSS
 * modules). Re-declared against the shared `--dsw-alias-*` tokens, namespaced
 * under `kb-` to avoid collisions. Tokens carry no fallback because the host
 * theme always defines them on the app root.
 */
export const KANBAN_STYLES = `
.kb-sidebar-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 100%; height: 32px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 18px; cursor: pointer;
  white-space: nowrap;
}
.kb-sidebar-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.kb-overlay {
  position: fixed; inset: 0; z-index: 50;
  display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-app);
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
.kb-icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 32px; height: 32px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 18px; cursor: pointer;
}
.kb-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
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
  background: var(--dsw-alias-bg-module);
}
.kb-column-head { display: flex; align-items: center; gap: 8px; }
.kb-column-title { margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; }
.kb-column-count {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary);
}
.kb-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.kb-dot-todo { background: var(--dsw-alias-chart-4, #8a94a6); }
.kb-dot-in_progress { background: var(--dsw-alias-accent, #4f8cff); }
.kb-dot-done { background: var(--dsw-alias-success, #34b26b); }
.kb-card {
  display: flex; flex-direction: column; gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-module-platform);
}
.kb-card-title { margin: 0; font-size: 13px; line-height: 18px; word-break: break-word; }
.kb-card-desc { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); word-break: break-word; }
.kb-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kb-tag {
  font-size: 11px; line-height: 16px; padding: 1px 6px; border-radius: 6px;
  background: var(--dsw-alias-bg-module); color: var(--dsw-alias-label-secondary);
  border: 1px solid var(--dsw-alias-border-l1);
}
.kb-card-actions { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.kb-mini-btn {
  display: inline-flex; align-items: center; gap: 4px;
  height: 24px; padding: 0 8px; border: none; border-radius: 6px;
  background: var(--dsw-alias-interactive-bg); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 12px; line-height: 16px; cursor: pointer;
}
.kb-mini-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.kb-mini-btn-danger:hover { background: var(--dsw-alias-bg-danger, rgba(220,60,60,0.15)); color: var(--dsw-alias-danger, #d4380d); }
.kb-status-select {
  height: 24px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px;
}
.kb-composer {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px;
  padding: 12px; background: var(--dsw-alias-bg-module);
}
.kb-composer-row { display: flex; gap: 8px; align-items: center; }
.kb-input {
  flex: 1; height: 32px; padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-input, transparent);
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px;
}
.kb-input:focus { outline: none; border-color: var(--dsw-alias-border-l3); }
.kb-primary-btn {
  height: 32px; padding: 0 16px; border: none; border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-button-primary-text, #fff);
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
}
.kb-primary-btn:hover { opacity: 0.9; }
.kb-primary-btn:disabled { opacity: 0.5; cursor: default; }
.kb-loading, .kb-empty, .kb-error {
  padding: 24px; text-align: center; font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.kb-empty { border: 1px dashed var(--dsw-alias-border-l3); border-radius: 12px; }
.kb-error { color: var(--dsw-alias-danger, #d4380d); }
`
