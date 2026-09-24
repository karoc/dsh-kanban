# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.10] - 2026-09-25

### Changed

- **The dsh floor is now declared as a peer dependency, not only documented.**
  `package.json` declares an optional peer on
  `@deepseek-ai/dsh-client-ui-slots: ">=0.1.7-rc.1"`. The gate that reads it ships from **DSH 0.1.7-rc.1** on — it compares every
  `@deepseek-ai/dsh*` peer against the running runtime and refuses a plugin the
  runtime fails, printing the `dsh plugin allow-version` remedy. Runtimes older than that gate
  evaluate **no** peers and refuse nothing: on 0.1.2–0.1.6 the client half cannot
  render (the `*Regular` icon names it imports arrived in 0.1.7-alpha.1), so
  **0.2.8 remains the release for 0.1.2–0.1.6** — the 0.1.7 alphas already have
  those icons and work. Verified live: the board (host half) is loaded on
  dsh 0.1.7-rc.2, which evaluated this range at startup. It is marked
  `peerDependenciesMeta.optional` because the host supplies that package at
  runtime — npm therefore installs nothing extra. The prerelease rule the range encodes (measured with the semver DSH actually
  resolves: 7.8.5, the copy `@deepseek-ai/dsh-app-boot` links to): `>=0.1.7` and
  `^0.1.7` do **not** match a `0.1.7-rc.N` runtime, hence the explicit `-rc.1`
  floor. semver 7.7.4 answers `true` for the caret form — spelling the
  prerelease out is what keeps the range unambiguous.

### Tests

- **Negative controls, now part of `npm test`** (`npm run test:controls`).
  `scripts/test-negative-controls.mjs` clones the committed tree per scenario,
  injects ONE defect and asserts the responsible gate fails with the documented
  message: dirty tree, removed CHANGELOG entry, deleted release tag, removed
  build artifact, and a guarantee row whose pinning test title is gone — plus a
  positive control (an unmutated clone must pass). 5/5 mutations caught.
- **Guarantee gate, now part of `npm test`.** `docs/guarantees.md` lists the
  promises this plugin must not break — done cards are **archived, never
  deleted**; a structurally broken or invalid `KANBAN.json` **fails loud**
  instead of being silently repaired; unknown ids/statuses are rejected; the
  workspace path must be absolute — and names the test title that pins each one;
  `scripts/check-guarantees.mjs` fails the suite when a title disappears
  (13 rows today). Verified by negative control: a row pointing at a
  non-existent title makes the gate FAIL.
- **Type-checked against DSH 0.1.7-rc.2** (2026-09-25): `tsc --noEmit` is green
  for both halves with the rc.2 type surface, and a seam-by-seam diff of
  rc.1→rc.2 shows every slot, client service and imported symbol the board uses
  is unchanged or purely additive. The board was **not** restarted onto rc.2 for a browser GUI pass at the time of
  writing; since then the host half has been running on dsh 0.1.7-rc.2 (the
  string "no GUI pass" refers to the browser half only).

## [0.2.9] - 2026-09-23

Verified against **DSH 0.1.7-alpha.1** (the runtime this machine now runs; the previous check was 0.1.6-alpha.2). One visual-language adaptation; no behavior change.

### Fixed

- **DSH 0.1.7 renamed every icon this plugin used (visual-language unification, upstream commit 4937343a5e).** The size-suffixed names — `IconChevronDownOutline14`, `IconChevronLeftOutline14`, `IconQueueOutline14`, `IconChecklistOutline14`, `IconCloseOutline16`, `IconGoalOutline16`, `IconListPenOutline16`, `IconPlusOutline16`, `IconRefreshOutline16`, `IconThinkOutline16`, `IconTrashOutline16`, `IconWarningOutline16`, `IconInspectOutline12` (13 names across `BoardPage.tsx` + `KanbanSurface.tsx`) — no longer exist in `dsh-client-ui-primitives`; each resolved to `undefined`, so the board entry crashed on render (`React error #130`, `slot entry crashed in 'sidebar.panellist'`) and the panel never appeared. All imports now use the `*Regular` (1 px) stroke variants — the weight the built-in settings pages use — and every rendered size is unchanged (the new artworks keep the old defaults: chevrons/queue/checklist 14 px, close/goal/list-pen/plus/refresh/think/trash/warning 16 px, inspect 12 px).

### Notes

- Re-checked the two upstream facts `src/client/workspace-pick.ts` encodes against 0.1.7: `retainedBy.mainView` is still the shell's current-session predicate and `recentWorkspaceId` is still absent from `WorkspaceSnapshot` — no change needed. `pnpm check:tokens` against the 0.1.7 theme stylesheet stays green.
- **Support floor**: the client half now requires **DSH ≥ 0.1.7** (the `*Regular` icon variants exist from 0.1.7 on); 0.2.8 remains the release for 0.1.2–0.1.6, whose dual-era session reads ship unchanged in this version and still degrade gracefully if an older shell runs the host half.
- Verified live on DSH 0.1.7-alpha.1 (2026-09-23, isolated DSH_HOME + Playwright): `accept-gui.mjs` ✅ ACCEPTED (9/9 — sidebar entry, opaque panel, three columns, add / move / delete card), browser console clean (the previous `slot entry crashed in 'sidebar.panellist'` #130 is gone).
- **README figure**: the board figure predates the icon refresh (the three-column content is the same; the icons are now 1 px stroke). Refresh in a later pass against a live dsh web: `DSH_GUI_URL='http://127.0.0.1:3080/?token=…' node scripts/capture-board-page.mjs`.

## [0.2.8] - 2026-09-21

Verified against **DSH 0.1.6-alpha.2** (the runtime this machine now runs; the previous check was 0.1.3-alpha.1). The audit of that gap produced three behavior fixes, two new delivery/verification mechanisms, and one UX migration.

### Changed

- **The board is now a DSH global panel** (`sidebar.panellist` glyph + keyed `main` occupant, the seam DSH 0.1.6 introduced for exactly this kind of page — the built-in Plugins page uses it). The sidebar shows 「思磨力看板」 in the global-panels section with the open-item count badge on the glyph, and selecting it renders the three-column board in the centre column; the header's exit button is now 「返回会话」/“Back to conversation” (`ctx.layout.selectPanel(null)`) instead of an overlay close. Gone with the overlay: the fixed full-screen container, its `z-index`, and the module-level open/close observable (`src/client/board-state.ts`).
- **The kanban-use skill is served by the shell's skill registry** (`ctx.skills.register`, host half) instead of only being copied into `~/.agents/skills`. The skill version now IS the plugin version: no stale copy can shadow it (runtime entries outrank user-level ones), and a packed skill whose frontmatter DSH cannot parse can no longer go stale on disk. The copy installer stays as the fallback for shells without the skill service.
- **Prompt-snapshot text is literal by construction.** The runtime-context snapshot is interpolated by the shell, and an unresolvable `{{name}}` throws — so a card titled `修复 {{TOKEN}} 渲染` broke the snapshot for EVERY request while it was open. Card titles are now escaped (`literalPromptText`) and the static guidance section declares `interpolate: false`.

### Fixed

- **Board default workspace / sidebar badge lost the current session on DSH 0.1.6-alpha.2**: upstream removed `current` (and `currentAddress`) from the client `SessionListState`, and both consumers read it — silently degrading to the most-recent-workspace fallback. The current session is now derived the way the shell itself derives it (`retainedBy.mainView > 0`, the predicate ui-workspace's tree, ui-session's main binding and Settings use), with the pre-0.1.6 `current` field still honored so 0.1.2–0.1.5 keep working (`currentSessionId`, 5 new unit tests).
- **Three design tokens resolved to nothing, and two were used with the wrong semantics** (all pre-existing, found by the new token gate): `--dsw-alias-bg-module` and `--dsw-alias-bg-input` have never existed in DSH — the affected surfaces (spec warning, archived notice, detail text blocks, text inputs) were transparent; error and spec-warning text used `--dsw-alias-interactive-bg-hover-danger` (a 5%-alpha hover FILL) as a TEXT color, i.e. unreadable in the light theme. Now: warn panels use the shell's warn vocabulary (`state-warn-tertiary` fill + `state-warn-label` text), errors use `state-error-primary`, inputs use `bg-layer-1`, panels use `bg-module-platform`, and the badge uses `label-primary-foreground`.
- **`--dsw-font-mono` was never a DSH token** either: the mono surfaces now use the real stack (`--dsw-font-markdown-code-font-family` → `--ds-font-family-code`).

### Added

- **`scripts/check-tokens.mjs`** — design-token drift gate: every `var(--dsw-alias-*)` in `src/` must be defined by the installed DSH theme stylesheet, with a `--self-test` negative control proving the detector fails on an unknown token (a clean checkout without DSH prints an explicit SKIP line instead of a silent pass). Wired into `pnpm test`.
- **`scripts/check-client-wiring.mjs`** — pins the panel wiring statically (one `PANEL_ID` shared by the `main` key and the panellist `id`, no return of `shell.overlay`, both slot names present in the built bundle, `.kb-panel` styled and rendered), because `tsc` cannot prove two registrations agree on one id.
- **`scripts/verify-skill-runtime.mjs`** — loads the BUILT bundle against a real `@deepseek-ai/dsh-skill` registry: the shipped SKILL.md parses with the plugin's minimal frontmatter reader, the registration wins over a same-named user-level candidate, and the fallback declines cleanly when no skill service exists. Wired into `pnpm test`.

### Changed (Agent Note spec sync)

- **The Agent Note "non-trivial" rule moved upstream and is now re-stated**: DSH replaced the root `AGENTS.md` sentence ("Non-trivial changes MUST include an Agent Note…") with a scope rule in `.agents/notes/README.md` → *When to write one* (AGENTS.md keeps a one-line pointer): a note is for **lasting decision rationale that code, tests, and existing documentation do not explain**; mechanical or local edits — **including local UI presentation and interaction changes** — are exempt; updating the note that already owns the decision satisfies the rule (no duplicates); an existing note is never edited into a *different* decision (supersede + cross-link). `src/note-spec.ts` (`NOTE_SPEC_VERSION` 1 → 2), the `note_add` / system-prompt guidance, the Web "Agent Note spec" source hints, and `scripts/check-note-spec.mjs` (new anchor: the notes README plus the AGENTS.md pointer) all follow. The spec gate now also proves it can fail: deleting an anchor from the definition reddens it. `skills/kanban-use/SKILL.md` carries the same scope test (`skill-version` 2 → 3, so the copy fallback resyncs on older shells; the runtime path serves the new body with the plugin version).

### Notes

- Live-GUI scripts (`accept-gui.mjs`, `verify-ux.mjs`, `verify-completeness-ui.mjs`, `verify-badge-workspace.mjs`, `verify-injection-real-3080.mjs`) match the new surface (`button:has(.kb-panel-icon)`, `.kb-panel[data-testid="kanban-page"]`, `.kb-panel-badge`).
- **Three live-GUI script defects fixed while verifying** (all in the "pass the launch URL as `DSH_GUI_URL`" path the README documents): `verify-ux.mjs` built its API base by appending `/kanban/api` to the FULL URL, so a token-carrying `DSH_GUI_URL` produced an invalid request and an empty body (`Unexpected end of JSON input`) — it now uses `new URL(BASE).origin`; `verify-badge-workspace.mjs` hardcoded the two workspaces' live open-card counts (they go stale every time a board changes) — it now reads them from each `KANBAN.json` and fails loudly when the two counts are equal (the switch would not be observable); `verify-injection-real-3080.mjs` hardcoded an expected card title AND posted its probe into the first existing session row (usually the user's own conversation) — it now derives the expected titles from the board on disk and sends the probe from a newly created session.
- **The README figure is referenced by absolute URL** (`raw.githubusercontent.com/.../main/docs/screenshots/board-page.png`): `docs/` is not in the npm `files` list, so the relative path rendered as a broken image on the package page. (Including the 285 kB PNG in the tarball was rejected — it would quadruple the 68 kB package for one figure.)
- `scripts/capture-board-page.mjs` refreshes the README figure from the live GUI. It captures the board PANEL element, never the window: the sidebar shows the user's session list and this README is public.
- Upgrading needs nothing from the user beyond a browser refresh: the client half is re-served from `lib/client.js` (the profile links this checkout).

### Verification (live, DSH 0.1.6-alpha.2, 2026-09-21)

- `pnpm accept`: sidebar global-panel row visible → board renders in the centre column (opaque) → row marked `aria-current=page` → three columns → add / move / delete card. ✅
- `verify-ux.mjs`: 13/13 (two-line clamp, detail dialog full content, focus trap, scroll position survives a silent refresh, poll actually advanced). ✅
- `verify-completeness-ui.mjs`: title-only card shows the missing-field hint on the panel. ✅
- `verify-badge-workspace.mjs`: badge follows the switched workspace (5 → 2 → 5), i.e. the `currentSessionId` fix works against the live session state. ✅
- `verify-injection-real-3080.mjs` (real model, no tools allowed): the model reproduced **2/2** open card titles from the session-start snapshot. ✅

## [0.2.7] - 2026-09-20

### Fixed

- **kanban-use 技能曾对 DSH 完全不可见（静默丢弃）**：`skills/kanban-use/SKILL.md` 的 `description` frontmatter 值含 ASCII `": "`（冒号+空格）却未加引号，YAML 在 compact mapping 里把它读成嵌套 mapping。DSH 的 skill provider 对这类文件只写一条服务端 warn 就丢弃，于是该技能既不在模型可用的技能目录里、用户界面上也没有任何提示。现改为双引号 YAML 标量（内部引号转义为 `\"`），文本逐字保留。

### Changed

- **`skill-version` 由 1 升到 2**。上面的 frontmatter 修复属于技能**内容变更**，而 `src/skill-sync.ts` 只在包内指纹**更新**时才覆盖已安装的本地副本。不升指纹的话，任何已经装过 v1 技能的机器都会保留那份坏副本（"同版本但内容不同"被策略判为用户编辑而刻意保留），修复只能到达全新安装——即"修了但等于没修"。

## [0.2.6] - 2026-09-08

### Added

- **`recentWorkspaceId` derivation with unit tests**: new `src/client/workspace-pick.ts` (pure function) plus `scripts/workspace-pick.spec.mjs` (8 cases, part of `pnpm test`) derive the most-recently-active workspace from the workspaces + sessions feeds, mirroring DSH's official ui-workspace `recentWorkspace` semantics — the workspace whose attached sessions have the latest `updatedAt`, falling back to the workspace's own `createdAt` when it has no session.

### Fixed

- **Board default workspace / sidebar badge no longer silently pin to the first workspace**: DSH removed the `recentWorkspaceId` field from the `WorkspaceSnapshot`, and the client still read it — with no current-session cwd available, the board page's default workspace and the badge's fallback degraded to the first registered workspace. Both consumers now use the new derivation (the current session's cwd remains the primary source).
- **Live-GUI verification scripts adapt to DSH 0.1.3-alpha.1**: the composer input changed from `<textarea>` to a contenteditable div; the seven live-GUI scripts now match `textarea, [contenteditable="true"]` so the same scripts run against both 0.1.2 and 0.1.3. `verify-injection-real-3080.mjs` additionally reads `DSH_GUI_URL` (token handshake like the other scripts) and opens a session in the target workspace before sending the probe; the badge / injection scripts' fixture card titles were refreshed to the machine's live boards.

## [0.2.5] - 2026-09-06

### Changed

- **Brand standardized to Smoothly Kanban (思磨力看板)**: the plugin's user-visible name is now **Smoothly Kanban** in English and **思磨力看板** in Chinese (brand: Smoothly / 思磨力), replacing the former "DSH Smoothly Kanban (DSH SK)" everywhere — board page title, sidebar entry (`「思磨力看板」` / "Smoothly Kanban"), bilingual README headings and intro, package description, and the system-prompt guidance's reference to the Web page. The technical identifiers are unchanged: npm package `dsh-kanban`, plugin runtime id `dsh-kanban`, bundle/route prefixes (`/kanban/api`), tool names, and `KANBAN.json` — the rebrand is user-facing only.

### Fixed

- **post-publish-check polls `dist-tags.latest` instead of snapshotting it**:
  npm writes the version document first and flips the `latest` dist-tag a
  moment later (registry eventual consistency), so the old one-shot read right
  after upload could catch the previous tag and trip a false alarm — the
  real 0.2.4 incident printed `latest is 0.2.3, expected 0.2.4` and exited 1
  while the publish was perfectly fine. The tag is now polled with the same
  cadence as version visibility (up to 14 × 3s), reporting only when it still
  has not caught up; a deliberate `--tag` publish is called out as the expected
  exception. Normal publishes take zero extra time (first probe matches).

## [0.2.4] - 2026-09-01

### Added

- **Brand name**: DSH Smoothly Kanban (DSH SK) — used in the README, board page title, and changelog.

## [0.2.3] - 2026-08-31

### Fixed

- **DSH 0.1.2-alpha.2 compatibility** (adapting to upstream breaking changes):
  `@deepseek-ai/dsh-client-runtime` and `@deepseek-ai/dsh-client-web-react`
  were removed from DSH — the client-half context type now comes from
  `@deepseek-ai/cordis` (`Context`), the `ctx.slots` type augmentation is
  pulled from `@deepseek-ai/dsh-client-ui-renderer/client`, and the
  `dsh.client.inject` manifest plus the tsdown `CLIENT_EXTERNALS` list drop the
  dead packages. The card-detail `Modal` no longer passes `closeLabel` with
  `headless` (the primitives' discriminated union rejects that combination;
  the headless render path never used it). Runtime platform-module surface is
  unchanged — react / react/jsx-runtime / `dsh-client-ui-primitives`
  client-side, `dsh-tools` host-side. Verified 9/9 GUI acceptance +
  4/4 completeness checks on the live alpha.2 GUI.

### Changed

- **GUI verification scripts authenticate through the new browser-auth gate**:
  since DSH 0.1.2-alpha.2 the Web GUI's index answers `401` without a
  browser-session cookie, which broke every Playwright script's plain
  `page.goto`. A shared `scripts/gui-auth.mjs` now performs the `/?token=`
  handshake automatically (token from `DSH_WEB_TOKEN`, or embedded in
  `DSH_GUI_URL`), and all nine live-GUI scripts use it — instances where auth
  is disabled keep working untouched. `accept-gui`'s delete step also finishes
  the confirmation dialog (the trash button opens one since 0.2.0; the script
  never confirmed it, so that assertion always failed).

## [0.2.2] - 2026-08-29

### Fixed

- **Windows: board writes survive the poll-vs-write rename race**
  ([PR #1](https://github.com/karoc/dsh-kanban/pull/1) by
  [@zenggaofeng001](https://github.com/zenggaofeng001)): the Web board page
  polls `KANBAN.json` every 15s; on Windows a rename-over that lands while the
  target is momentarily held open by a read handle fails with `EPERM`
  (`MoveFileExW(REPLACE_EXISTING)`) and used to surface as a hard write failure
  on `board_add` / `board_update` / archival. Both write paths (KANBAN.json and
  the archive) now commit through `renameWithRetry` — retries only on `EPERM`
  with bounded backoff (5 attempts, ~250 ms) before giving up; POSIX behavior
  unchanged. Verified on Linux and a real Windows host.

## [0.2.1] - 2026-08-24

### Changed

- **kanban-use skill installs itself**: the skill and its installer now ship
  inside the npm tarball (`skills/kanban-use/SKILL.md`,
  `scripts/install-skill.mjs`), and the host half self-heals
  `~/.agents/skills/kanban-use/SKILL.md` on every `dsh web` start — missing →
  copies the shipped file; identical → no-op; differs → keeps the local copy
  (user may have edited it) with a one-line hint. `dsh plugin add/update
  dsh-kanban` + the required restart is all it takes now; the manual
  `install:skill` commands remain for repo checkouts / forced syncs. The
  self-heal runs as a module top-level side effect (a call inside `apply()`
  alone was tree-shaken out of the bundle by rolldown — the documented §5
  trap, this time on the node half).
- **Skill upgrades now sync automatically (version fingerprint)**: the raw
  "content differs → keep local" rule confused a plugin upgrade (stale
  package content from the previous install) with a deliberate user edit, so
  skill updates never propagated. The skill's frontmatter now carries a
  numeric `skill-version` (bumped on content changes): same or higher version
  with different content = a user edit (kept, warned); older/absent version =
  stale package content (synced over). Users who customize the skill keep
  their edits safe by bumping the fingerprint themselves.
- **Delivery-manifest integrity at the gates**: `release-check` now verifies
  every `package.json` `files` entry exists in the tree (7b), and
  `check-card-discipline` asserts the skill and its installer are registered
  in `files` — an asset outside the manifest never ships to npm users, so
  this class of gap (e.g. the skill missing from the tarball pre-0.2.1) is
  now caught at development/release time instead of by users.

## [0.2.0] - 2026-08-23

### Changed

- **Silent auto-refresh (no more scroll loss)**: the board page's 15s poll now
  diffs by a content signature — when nothing changed it never touches the card
  state or the list DOM, so an open board no longer resets your reading/scroll
  position every poll. Cards are memoized, so an unchanged poll re-renders only
  the header's "auto-refreshed at HH:mm:ss" liveness line (new, second-resolution
  `formatTimeWithSeconds`); a failed background poll keeps the current view
  instead of flashing an error and wiping the board. The manual refresh button
  and workspace switch still use the blocking loading path.
- **Two-line clamped card fields**: each of the three what/why/rejected fields
  on a card preview now clamps to at most two lines with an ellipsis
  (`-webkit-line-clamp: 2`), keeping cards compact and scannable.
- **Card-completeness discipline (the three what/why/rejected fields are now
  part of the contract, not a bonus)**:
  - system-prompt guidance rewritten: creation = title + `rationale` (为什么)
    expected on every card, `rejected` (放弃了什么) when a decision ruled out
    an alternative, `summary` (做了什么) filled at completion; closing a card
    requires all three fields — a done card must be self-explanatory for the
    next session;
  - the shared predicate `missingCardFields` (board-core.ts) applies ONE rule
    everywhere: every card needs rationale; a done card needs summary +
    rationale + rejected;
  - model-visible feedback loop: board tool outputs and the `/kanban` command
    flag incomplete cards (`⚠️缺:…` per card plus a summary line), and the
    session-start snapshot marks open cards missing rationale (`(缺:…)`) so a
    resuming session can fill them;
  - the Web board page shows a warning line (`缺字段：…`) under any card
    missing fields, so incompleteness is visible to humans too;
  - `board_add` / `board_update` tool descriptions now state the rule instead
    of "optional" framing.

### Added

- **Card detail dialog**: the card's title + description + the three
  what/why/rejected fields form a clickable/keyboard-reachable region (with a
  subtle inspect affordance) that opens a headless `Modal` (`CardDetail`):
  full, newline-preserving content in labeled sections with icons, a status
  badge + tag pills, the source-session jump button, and created/updated
  timestamps — a formatted, reading-friendly view of the whole card.
- **The kanban-use skill, maintained in this repository**: `skills/kanban-use/SKILL.md`
  is the deep manual for the card-completeness discipline (field semantics,
  good/bad card examples, create → advance → close flow, close checklist,
  templates). The system-prompt guidance points the model at it; `pnpm install:skill`
  (`scripts/install-skill.mjs`) symlinks/copies it into `~/.agents/skills/kanban-use`
  so sessions can load it on demand. The new dev gate `pnpm check:cards`
  (`scripts/check-card-discipline.mjs`, part of `pnpm test`) asserts the skill's
  field semantics and tool names stay consistent with the plugin schema;
  `scripts/audit-cards.mjs <workspace> [--fail]` audits any workspace's
  `KANBAN.json` for incomplete cards under the same rule.

### Fixed

- **Sidebar badge now follows workspace switches**: the 「看板」 open-count
  badge resolved its workspace from the workspaces feed's `recentWorkspaceId`
  — which DSH projects as "the workspace with the most recently updated
  session", not the workspace the user is currently viewing — so after
  switching workspace the badge kept showing the previous workspace's count
  while the board page itself followed the current session. The badge now
  resolves from the current session's cwd first (the same rule the board page
  uses), falling back to the recent workspace, and subscribes to the session
  list (the feed that actually changes on a switch) in addition to the
  workspace list, so it re-resolves immediately.

## [0.1.2] - 2026-08-19

### Added

- **note_add DSH-depth guidance**: tool + parameter descriptions now direct the
  model to write engineering-grade Agent Notes — Decision in present tense with
  concrete names/contracts/boundaries and negative guarantees (what is NOT
  done), Alternatives that are REAL rejected options each with why, and
  Consequences recording what the trade-off cost AND bought; the system-prompt
  guidance matches. Verified with a real model: generated notes now include
  negative guarantees, real alternatives, present-tense facts, and boundaries.
- **Session-start board snapshot** (`ctx.systemPrompt.context`,
  `board:open-items`, order 114): every prompt assembly for an agent with a
  workspace injects the board's open items (todo + in_progress), so the model
  sees the board without having to remember to `board_list`. No agent / no cwd /
  empty board / read errors contribute nothing. Only open items are injected
  (done cards churn would disturb the prompt prefix / KV-cache stability).
- **Wrap-up discipline (usage-strategy D)**: the board guidance now tells the
  model to close the loop at the end of every work session — move completed
  cards to done, add follow-ups as todos, update summaries, never leave stale
  `in_progress` cards.
- **Sidebar open-count badge (usage-strategy C)**:
  - New lightweight host route `GET /kanban/counts?cwd=` returning `{ ok, open }`
    (todo + in_progress count).
  - `src/client/board-counts.ts`: module-level observable + polling; resolves
    the workspace from the workspaces feed's most-recent workspace and
    subscribes to workspace-list changes so the badge appears as soon as data
    is ready.
  - The sidebar 「看板」 entry shows the open count (wide + rail states, 99+
    cap).
- **Board page auto-refresh**: while open, the page refreshes every 15s so
  model/other-session writes appear without a manual refresh.

### Fixed

- **Card delete now requires confirmation**: clicking the trash icon opens a
  Modal naming the card and stating the removal is permanent and irreversible;
  only confirming deletes (Cancel / Escape keep it). Protects against accidental
  one-click loss.

### Changed

- **README transparency**: added "How it works & transparency" section (zh/en)
  documenting the two mechanisms that drive model usage (fixed guidance +
  session-start auto-injection) and the auto-injection trade-offs (guaranteed
  visibility vs per-request token overhead and KV-cache prefix changes),
  plus the data-safety commitment (write-only, archiving not deleting).

## [0.1.1] - 2026-08-18

### Changed

- Version-only bump (no functional changes shipped in this release; the
  following 0.1.2 carries the accumulated features).

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
