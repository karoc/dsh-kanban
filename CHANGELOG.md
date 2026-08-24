# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
