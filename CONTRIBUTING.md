# Contributing

Thanks for contributing to `dsh-kanban`. This is an external DSH plugin
published as an installable **bundle** — it never touches the dsh repository
source, so official upgrades cannot overwrite it.

## Development

Prerequisites: Node.js ≥ 18, [pnpm](https://pnpm.io).

```sh
pnpm install      # installs build deps (tsdown, react)
pnpm bundle       # emits lib/index.js (host half) + lib/client.js (browser half)
```

- `src/board-core.ts` — the `KANBAN.json` domain (shared by tools and route).
- `src/index.ts` — host half: 4 model tools + `/kanban/api` webServer route.
- `src/client/` — browser half: sidebar entry, full-screen board page, styles, locales.
- The client bundle keeps `@deepseek-ai/*` + `react` external (resolved from the
  loader module table at runtime); everything else is inlined.
- UI must stay aligned with DSH: use `--dsw-alias-*` design tokens, namespaced
  `kb-` to avoid collisions. Product copy is Chinese with a matching English key.

## Manual smoke check (no dsh server needed)

The host half can be verified in isolation:

```sh
node scripts/verify-tools.mjs
```

which boots `systemPrompt + ToolRuntime + FakeWebServer + kanban` on a bare
cordis context and prints the registered `board_*` tool names. The Web page and
the route are exercised against a real `dsh web` (install into a profile,
restart, open the sidebar 「看板」).

## Release contents (per version)

- Non-empty `CHANGELOG.md` entry matching `package.json` version.
- Both `README.md` and `README.zh.md` updated for user-visible changes.
- `lib/` built and fresh (`pnpm bundle`).
- Tag `v<version>` at HEAD.

## Policy notes

- A workspace owns one board; plans are expressed via tags or card groups.
- The `KANBAN.json` shape is validated on read — never silently repair a broken
  hand edit; fail loud instead.
