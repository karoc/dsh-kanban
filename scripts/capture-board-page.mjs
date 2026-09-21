// Refresh the README's board figure (docs/screenshots/board-page.png) from the
// live GUI. Development-only: needs a running `dsh web` plus the launch token
// (DSH_GUI_URL, or DSH_WEB_TOKEN for an instance whose index is gated).
//
// It captures the BOARD PANEL element, never the whole window: the sidebar now
// shows the user's session list, and this repository's README is public — the
// session titles are none of a reader's business. The figure therefore shows
// exactly what its caption claims (the three-column board), and the sidebar
// entry itself is described in prose.
//
// Run: DSH_GUI_URL='http://127.0.0.1:3080/?token=…' node scripts/capture-board-page.mjs
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { gotoApp } from './gui-auth.mjs'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
const TARGET = resolve(import.meta.dirname, '..', 'docs', 'screenshots', 'board-page.png')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 })
  await gotoApp(page, BASE)
  await page.waitForTimeout(5000)

  const entry = page.locator('button:has(.kb-panel-icon)').first()
  await entry.waitFor({ state: 'visible', timeout: 15000 })
  await entry.click()

  const panel = page.locator('.kb-panel[data-testid="kanban-page"]').first()
  await panel.waitFor({ state: 'visible', timeout: 15000 })
  // Let the first board fetch (and its counts) settle before the shot.
  await page.waitForTimeout(2500)

  await mkdir(dirname(TARGET), { recursive: true })
  await panel.screenshot({ path: TARGET })
  console.log(`captured ${TARGET} (board panel only — the sidebar stays out of the figure)`)
} finally {
  await browser.close()
}
