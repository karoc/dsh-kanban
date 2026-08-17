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

## Publishing to npm (human-operated, 2FA)

npm publishing is **human-operated**: the npm account requires two-factor
authentication (OTP), so an agent cannot complete the publish — only a human
can. The workflow:

1. **Prepare** (can be done by an agent): commit everything, bump
   `package.json` version, update `CHANGELOG.md` + bilingual README, run
   `pnpm bundle`, and run `pnpm release:check` until it passes.
2. **Tag**: `git tag v<version>` and push both `main` and the tag to GitHub.
3. **Publish (human)**:
   ```sh
   npm login     # interactive, 2FA
   npm publish   # runs prepublishOnly (release gate + build), then postpublish
   ```

The gate is **automated and blocking**:
- `prepublishOnly` runs `release-check.mjs` first, so `npm publish` cannot
  proceed until version / docs / changelog / tag / tree / build / registry all
  pass.
- `prepack` closes the `npm pack` route with the same gate.
- `postpublish` runs `post-publish-check.mjs` AFTER upload. It **polls the
  registry index** (npm is eventually consistent — the first `npm view` can
  404 for a few seconds) before judging `dist-tags.latest` and the published
  tarball's file list. A finding there means the release is already live; it
  does NOT mean the publish failed — do not re-publish the same version.

> `npm publish --ignore-scripts` bypasses every gate; it cannot be prevented
> mechanically. Treat any release published that way as manually verified.

## Policy notes

- A workspace owns one board; plans are expressed via tags or card groups.
- The `KANBAN.json` shape is validated on read — never silently repair a broken
  hand edit; fail loud instead.
- The plugin **only writes** board/note files; there is no startup, scheduled,
  or install-time cleanup. Cards are removed only by explicit `board_remove` /
  the Web delete button; excess done cards are archived, never deleted.
