# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-17

### Added

- **External DSH kanban bundle** (`dsh-kanban`): installable via
  `dsh plugin --profile web add`, never touches the dsh repository source.
- **Cross-session workspace board**: a git-trackable `KANBAN.json` at the
  workspace root, shared by every session under that directory. Data survives
  session switches and branches; nothing is ever auto-cleaned by the plugin.
- **Model tools** (host half):
  - `board_list` — read the workspace board (cards, status, tags, timestamps).
  - `board_add` — add a card with title + optional summary (what), rationale
    (why), rejected (gave up), description, status, tags; records the owning
    session id (`sourceSessionId`) so the handling session can be located.
  - `board_update` — move a card between `todo` / `in_progress` / `done` and
    edit its fields.
  - `board_remove` — delete a card by id.
- **Agent Notes** (full replication of the DSH repo discipline):
  - `note_add` writes `.agents/notes/implemented/<class>/<date>-<topic>.md`
    with the DSH format (`# Agent Note`, `Status: implemented`, `Problem`,
    `Decision`, `Alternatives considered`, `Consequences`).
  - `note_list` lists existing notes.
- **System-prompt guidance**: tells the model to proactively record plans and
  todos on the board, move cards as work progresses, and write an Agent Note
  for every non-trivial change (with the DSH definition of non-trivial).
- **Editable Agent Note spec** (reuse, not re-invention; synced via overrides):
  note classes / format template / non-trivial definition are replicated from
  the deepseek-harness repo as editable defaults in `src/note-spec.ts`. The Web
  board page has an **Agent Note spec** section: three inputs to paste newer
  upstream content (each with a source hint), overrides stored at
  `.agents/notes/overrides.json`, a `specVersion` / `pluginSpecVersion` update
  warning (updating the plugin resets overrides), save + reset.
  `scripts/check-note-spec.mjs` (`pnpm check:spec`) diffs the defaults against a
  local dsh checkout so upstream changes are caught at dev time.
- **Web board page** (client half):
  - `sidebar.footer.action` 「看板」 entry, styled like the Settings trigger
    (icon + left-aligned label).
  - `shell.overlay` full-screen three-column board (To do / In progress / Done)
    with per-card status move (Menu), delete, and an add composer (title + the
    three what/why/rejected inputs laid out in one row of three columns).
  - **Workspace switcher**: an explicit grey capsule at the top lists every
    registered workspace; the board follows the chosen workspace (defaulting to
    the current session's), so it is always clear which board you are viewing.
  - **Source-session locate**: cards created by the model show an
    "Open source session" button that jumps to the handling session.
  - **Done-card archiving**: when done cards exceed 100, the oldest are moved to
    `.agents/notes/archive.json` (git-trackable) and a notice shows the archive
    location; model tools render the same notice.
  - Column card lists are capped (~3.5 rows) and scroll; status menus are
    portaled so they are never clipped by the scroll container.
  - `--dsw-alias-*` design-token styles (namespace `kb-`), zh/en copy.
- **Data channel**: the page reads/writes `KANBAN.json` through the host
  `webServer` routes `GET/POST /kanban/api` and `GET/POST /kanban/spec` —
  independent of built-in dsh RPC, so official upgrades don't touch it.
- **`/kanban` command**: view the workspace board; `/kanban done <card-id>`
  marks a card done quickly.
- **Verification**: `pnpm test` (typecheck + 19 unit tests + tool/spec smoke),
  `pnpm verify`, `pnpm check:spec`, `pnpm accept` (GUI acceptance against a live
  dsh web); real-model end-to-end verified (proactive board_add/board_update +
  note_add).
- **Docs**: bilingual README, CHANGELOG, CONTRIBUTING, LICENSE.

### Security / data-safety notes

- The plugin **only writes** board/note files; there is no startup, scheduled,
  or install-time cleanup. Cards are removed only by explicit `board_remove` /
  the Web delete button; excess done cards are **archived** (moved to
  `.agents/notes/archive.json`), never deleted.
