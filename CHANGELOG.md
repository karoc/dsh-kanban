# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-16

### Added

- **External DSH kanban bundle** (`dsh-kanban`): installable via
  `dsh plugin --profile web add`, never touches the dsh repository source.
- **Host half** (`src/index.ts`, `src/board-core.ts`):
  - `KANBAN.json` domain at the workspace root: read/write with validation,
    atomic writes (tmp + rename), card CRUD (`add` / `update` / `remove`),
    statuses `todo | in_progress | done`, tags, timestamps.
  - Four model-facing tools: `board_list`, `board_add`, `board_update`,
    `board_remove`; workspace resolved from the calling session's cwd.
  - `webServer` route `GET/POST /kanban/api` backing the Web board page
    (read + add/update/remove, returns the fresh board view).
- **Client half** (`src/client/`):
  - `sidebar.footer.action` 「看板」 entry.
  - `shell.overlay` full-screen three-column board page (To do / In progress /
    Done) with per-card status move and delete, plus an add form.
  - Data flows through `fetch` to the host `/kanban/api` route.
  - `--dsw-alias-*` design-token styles (namespace `kb-`), zh/en copy.
- **Docs**: bilingual README, this changelog, CONTRIBUTING.
