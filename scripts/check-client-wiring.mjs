#!/usr/bin/env node
/**
 * Client-wiring gate (development-time, not shipped to users).
 *
 * The board page is a DSH global panel: a `main`-slot occupant keyed by the same
 * id as the `sidebar.panellist` glyph row. Nothing in `tsc` proves those two ids
 * are the SAME value (they are two separate registrations), and registering into
 * a single/occupied slot by mistake (e.g. going back to `shell.overlay`) is
 * invisible until someone opens the GUI. This gate pins the wiring statically:
 *
 *   1. the panel id is declared once (`PANEL_ID`) and used by both registrations;
 *   2. the `main` registration passes `key: PANEL_ID` (a keyed slot without a key
 *      renders nothing) and the panellist registration passes `id: PANEL_ID`;
 *   3. the retired `shell.overlay` registration does not come back;
 *   4. the built bundle carries both slot names (a rolldown/tree-shaking drop
 *      would otherwise only show up as a missing sidebar row);
 *   5. the page container class (`kb-panel`) exists in the injected styles and is
 *      the one BoardPage renders.
 *
 * Behavior on the live GUI is covered by the Playwright scripts
 * (accept-gui.mjs, verify-ux.mjs, verify-completeness-ui.mjs) — this gate only
 * proves the wiring survived an edit. Run: node scripts/check-client-wiring.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const fail = message => failures.push(message)
const read = path => readFileSync(resolve(root, path), 'utf8')

const entry = read('src/client/index.ts')
const surface = read('src/client/KanbanSurface.tsx')
const page = read('src/client/BoardPage.tsx')
const styles = read('src/client/styles.ts')

// 1) One panel id, declared once.
if (!/const PANEL_ID = 'kanban' as MainPanelId/.test(entry)) {
  fail('src/client/index.ts must declare `const PANEL_ID = \'kanban\' as MainPanelId` — the sidebar row and the main occupant share this value')
}

// 2) Both registrations, wired to that id.
const mainRegistration = /name: 'main',\s*\n\s*key: PANEL_ID,/.test(entry)
if (!mainRegistration) fail("the 'main' registration must pass `key: PANEL_ID` (a keyed slot without a key renders nothing) — the sidebar glyph would select an empty panel")
const panelListRegistration = /name: 'sidebar\.panellist',\s*\n\s*id: PANEL_ID,/.test(entry)
if (!panelListRegistration) fail("the 'sidebar.panellist' registration must pass `id: PANEL_ID` — it is what links the sidebar row to the panel")

// 3) The retired overlay surface must not return.
if (entry.includes("'shell.overlay'")) {
  fail("the client half registers into 'shell.overlay' again — the board moved to the global-panel seam (main + sidebar.panellist); restore the panel registration instead")
}
if (!entry.includes('KanbanPanel') || !entry.includes('KanbanPanelIcon')) {
  fail('the client entry must use KanbanPanel (main occupant) and KanbanPanelIcon (sidebar glyph) from KanbanSurface.tsx')
}
if (surface.includes('kb-sidebar-trigger') || styles.includes('kb-sidebar-trigger')) {
  fail('the footer-trigger styles are back — the sidebar owns the panel row; our side only draws the glyph (.kb-panel-icon)')
}

// 4) The built bundle must carry both slot names.
try {
  const bundle = read('lib/client.js')
  for (const slot of ['sidebar.panellist', 'main']) {
    if (!bundle.includes(slot)) fail(`lib/client.js does not contain the ${slot} registration — rebuild (pnpm bundle) or the registration was dropped`)
  }
  if (!bundle.includes('kb-panel-icon')) fail('lib/client.js does not contain the panel glyph class — rebuild (pnpm bundle)')
} catch {
  fail('lib/client.js is missing — run `pnpm bundle` before this gate')
}

// 5) The page container matches the injected styles.
if (!/\.kb-panel \{/.test(styles)) fail('src/client/styles.ts has no .kb-panel rule — the panel container is unstyled')
if (!page.includes('className="kb-panel"')) fail('BoardPage.tsx no longer renders className="kb-panel"')
if (page.includes('kb-overlay')) fail('BoardPage.tsx still renders kb-overlay — the panel replaced the overlay')

if (failures.length > 0) {
  for (const failure of failures) console.error(`✘ ${failure}`)
  process.exit(1)
}
console.log('✅ client wiring gate passed: global panel (main + sidebar.panellist) is registered, built, and styled')
