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
- `src/client/` — browser half: the global-panel entry (`sidebar.panellist` glyph + `main` occupant), the board page, styles, locales.
- The client bundle keeps `@deepseek-ai/*` + `react` external (resolved from the
  loader module table at runtime); everything else is inlined.
- UI must stay aligned with DSH: use `--dsw-alias-*` design tokens (verified by
  `pnpm check:tokens`), namespaced `kb-` to avoid collisions. Product copy is
  Chinese with a matching English key.

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
- **README figure current**: the board figure must show the current UI
  (`node scripts/capture-board-page.mjs` with a live `dsh web` + `DSH_GUI_URL`).
  The script captures the board PANEL only, never the window — the sidebar shows
  the maintainer's session list and this README is public.
- Tag `v<version>` at HEAD.
- **Changed the skill content? Bump `skill-version` in
  `skills/kanban-use/SKILL.md`.** On DSH ≥ 0.1.6 the skill is served straight
  from the package (`ctx.skills.register`, `src/skill-register.ts`), so the
  installed copy in `~/.agents/skills` is bypassed and no bump is needed; the
  fingerprint still drives the COPY FALLBACK (`src/skill-sync.ts`) used on older
  shells, where "same version, different content" is deliberately treated as a
  user edit and KEPT. Ship a content change under an unchanged fingerprint and
  the fix reaches fresh installs only. `check-card-discipline.mjs` can only
  assert the field exists and is numeric, so this bump is on the maintainer.
- **Keep `skills/kanban-use/SKILL.md` frontmatter parseable.** Two parsers read
  it: DSH's YAML (for the copy fallback) and this plugin's minimal reader in
  `src/skill-register.ts` (for the runtime registration). An UNQUOTED
  `description` containing an ASCII `": "` is read by YAML as a nested mapping,
  and DSH's skill provider then drops the whole file with only a server-side
  warning — the skill disappears from the model catalog and from the user's view
  with no visible error. Quote the value (escaping inner `"` as `\"`) or use a
  full-width colon. `scripts/verify-skill-runtime.mjs` (part of `pnpm test`)
  fails when the flat `name`/`description` shape breaks, so a mistake here now
  reddens the suite instead of degrading silently.
- **Upgrading the DSH the plugin runs against?** Run `pnpm check:tokens` (it
  reads the INSTALLED `@deepseek-ai/dsh-client-ui-theme` stylesheet) and re-read
  the panels it touches: `src/client/workspace-pick.ts` encodes two upstream
  facts (the `recentWorkspaceId` removal in 0.1.3-alpha.1 and the `current`
  removal in 0.1.6-alpha.2). Unknown CSS custom properties and removed snapshot
  fields both fail SILENTLY — nothing throws, the UI just goes flat.
  Icon exports fail the other way: 0.1.7 dropped the size-suffixed names
  (`IconX14` / `IconX16` became the `*Regular` / `*Medium` stroke variants of
  `IconX`), and an import that no longer resolves is an undefined component
  that crashes its slot entry on first render — `tsc --noEmit` in `pnpm test`
  catches it before that.

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
