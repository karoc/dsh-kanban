# dsh-kanban

English | [简体中文](README.zh.md)

[![license MIT](https://img.shields.io/npm/l/dsh-kanban.svg)](LICENSE)

An **external** DeepSeek Harness plugin: a cross-session, cross-branch, persistent **plan / todo kanban board**.

When you chat with an agent (in dsh, Codex, Claude Code, …) you produce lots of plans and todos — and the pain is that once you switch to another branch or open a new session, those plans and todos become invisible: they still live in the long conversation, but you can't find them or remember them.

`dsh-kanban` sinks plans and todos into a **`KANBAN.json` file at the workspace root** (git-trackable, human-editable, survives sessions) and gives you two ways to maintain it:

- **Model entry**: 4 model-facing tools (`board_list` / `board_add` / `board_update` / `board_remove`) so the model records plan steps and todos while talking.
- **Web entry**: a new 「看板」 button in the dsh Web GUI sidebar that opens a **full-screen three-column board page** (To do / In progress / Done) with view, status move (incl. mark done), add, and delete.

The same `KANBAN.json` is shared by the model tools and the Web page, so **what the model writes, the page shows; what you check off on the page, the model reads next time.**

## What it adds

### Model tools (host half)

| Tool | Purpose |
|---|---|
| `board_list` | Read the current workspace board (all cards with status, tags, timestamps). Call it before any update to get real ids. |
| `board_add` | Add a card (title required; optional description / status / tags). |
| `board_update` | Update a card by id (status / title / description / tags). |
| `board_remove` | Remove a card by id. |

The board is scoped to the **current session's working directory (cwd)**: every session under the same project directory shares one `KANBAN.json` — that's what makes it survive across sessions and branches.

### Web board page (client half)

- A 「看板」 entry in the sidebar footer (`sidebar.footer.action`);
- A full-screen three-column board: **To do / In progress / Done**, each column with a card count;
- Per card: a status dropdown (including "done"), and delete; an add form (title + optional description, Enter to submit) at the bottom;
- The page reads/writes the same `KANBAN.json` through the host-registered `/kanban/api` webServer route (GET read, POST add/update/remove) — independent of built-in dsh RPC, so official upgrades don't touch it.

### Data file

```
<workspace root>/KANBAN.json
```

```json
{
  "version": 1,
  "cards": [
    { "id": "card-xxxx", "title": "implement kanban tools", "description": "…", "status": "todo", "tags": ["dsh"], "createdAt": 1234567890, "updatedAt": 1234567890 }
  ]
}
```

The file shape is validated: a missing file reads as an empty board; a structurally broken file fails loud instead of being silently repaired (so a hand edit gone wrong never loses data quietly).

## Install

**Prereq:** a DeepSeek Harness with the `dsh` CLI, plus [pnpm](https://pnpm.io). This is an installable **bundle** — loaded by `dsh`, not imported as a library.

### From a local dev checkout

```sh
dsh plugin --profile web add /home/karoc/dsh-kanban
```

### From npm (after publishing)

```sh
dsh plugin --profile web add dsh-kanban
```

### From git

```sh
dsh plugin --profile web add github:karoc/dsh-kanban#<sha>
```

Git installs run the package `prepare` script to build the bundle; pnpm ≥ 10 asks you to allowlist the build once in the profile's `pnpm-workspace.yaml` (`allowBuilds`), then re-run `add`.

**You must restart `dsh web` after installing** for both the host tools and the Web page to load.

### Update / remove

```sh
dsh plugin --profile web update dsh-kanban
dsh plugin --profile web remove dsh-kanban   # removes dependency + bundle layer; entry disappears after restart
```

## Usage

1. Install, restart `dsh web`; the sidebar footer shows the 「看板」 button.
2. Ask the model to record plan steps with `board_add` (e.g. "put xxx on the board"); it writes the current workspace's `KANBAN.json`.
3. Open 「看板」 anytime for the three-column view; mark done / move / add / delete directly on the page.
4. After switching branches or opening new sessions the board is still there — it's just a file in the workspace.

## Directory layout

```
cordis.patch.yml        # bundle layer: mounts this package (host tools + client half)
package.json            # dsh.bundle (patch) + dsh.client (web) + exports["./client"]
tsdown.config.ts        # self-contained build: node half + module-table client bundle
src/board-core.ts       # KANBAN.json domain: read/write, validation, card CRUD (shared)
src/index.ts            # host half: 4 model tools + /kanban/api webServer route
src/client/index.ts     # client apply: sidebar entry + full-screen board page
src/client/BoardPage.tsx       # three-column board component
src/client/KanbanSurface.tsx   # sidebar button + overlay wrapper
src/client/board-state.ts      # module-level page visibility observable
src/client/locales.ts          # zh/en copy
src/client/styles.ts           # --dsw-alias-* design-token styles
```

## Why an external plugin

dsh's official updates only touch the bundled in-repo packages. An **external bundle** is installed into the user profile via `dsh plugin` and is never touched by official upgrades (same pattern as `dsh-model-reasoning`). The plugin only uses dsh's externally stable capability surface: tool registration (`ctx.tools`), webServer route registration, and the Web sidebar/overlay slots.

## Known limitations (v1)

- **dsh only**: aggregating Codex / Claude Code todos is future work (the `KANBAN.json` file is plain, so any tool can read it later).
- **No auto-extraction**: model-driven writes plus manual page maintenance keep the data clean and controllable.
- **One board per workspace**: a flat card list; plans are expressed via tags or card groups (no multi-board / nested columns).
- **JSON first**: machine-friendly and diff-friendly; a `KANBAN.md` render view can come later.

## Development

```sh
pnpm install   # build deps (tsdown, react)
pnpm bundle    # emits lib/index.js + lib/client.js
```

- `src/client/` is the browser plugin; the client bundle keeps `@deepseek-ai/*` + `react` external (resolved from the loader module table at runtime) and inlines everything else.
- UI uses `--dsw-alias-*` design tokens, namespaced with the `kb-` prefix.

## Verification

```sh
pnpm test       # tsc --noEmit typecheck + 14 KANBAN.json domain unit tests + host tool smoke
pnpm typecheck  # typecheck only (tsc --noEmit)
pnpm verify     # 4 board tools registered + board_add persisted end-to-end
pnpm accept     # GUI acceptance against a running dsh web (http://127.0.0.1:3080):
                #   native-DSH sidebar entry → opaque full-screen three-column page
                #   → add / move / delete
```

External plugins get no compile-time typechecking by default (tsdown only
transpiles); `tsc --noEmit` in `pnpm test` catches "used-but-not-imported"
mistakes that would otherwise crash at runtime (a missing `IconCheckOutline16`
import once took down the whole board page).

`scripts/verify-model-board.mjs` additionally verifies a **real model call**: it sends
the GUI agent an instruction to use `board_add`/`board_list`, then confirms the card
lands in `KANBAN.json` at the session cwd and is visible on the board page (the
model-writes ↔ Web-sees round trip).

## License

[MIT](LICENSE)
