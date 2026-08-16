/**
 * GUI acceptance for the dsh-kanban plugin against the live Web GUI
 * (http://127.0.0.1:3080). Uses playwright's chromium (already installed).
 *
 * Checks:
 *  1. The sidebar footer shows the 「看板」 entry.
 *  2. Clicking it opens the full-screen board page (data-testid="kanban-page").
 *  3. The three columns (todo / in_progress / done) render.
 *  4. Adding a card through the composer works and persists.
 *  5. Moving a card to done works.
 *  6. Deleting a card works.
 *
 * Run: node scripts/accept-gui.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
const CWD = process.env.DSH_ACCEPT_CWD ?? '/home/karoc/kanban-accept'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', err => console.log('  [pageerror]', err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [console.error]', msg.text())
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  // Let the web client boot its plugin tree.
  await page.waitForTimeout(4000)

  // 1) Sidebar footer 「看板」 entry.
  const kanbanButton = page.locator('button.kb-sidebar-btn').first()
  try {
    await kanbanButton.waitFor({ state: 'visible', timeout: 15000 })
    record('sidebar 「看板」 entry visible', true)
  } catch {
    // Maybe the sidebar is collapsed to a rail; try expanding is complex — report as-is.
    record('sidebar 「看板」 entry visible', false, 'button.kb-sidebar-btn not found')
    // Still try clicking whatever matched.
  }

  // 2) Click to open the board page.
  await kanbanButton.click().catch(() => {})
  await page.waitForTimeout(1500)
  const overlay = page.locator('.kb-overlay').first()
  let pageOpened = false
  try {
    await overlay.waitFor({ state: 'visible', timeout: 10000 })
    pageOpened = true
    record('full-screen board page opens', true)
  } catch {
    record('full-screen board page opens', false, '.kb-overlay not visible')
  }

  if (pageOpened) {
    // 3) Columns render.
    const cols = page.locator('.kb-column')
    const colCount = await cols.count().catch(() => 0)
    record('three board columns render', colCount === 3, `${colCount} columns`)
    const titles = []
    for (let i = 0; i < colCount; i++) {
      titles.push((await cols.nth(i).locator('.kb-column-title').textContent().catch(() => '')) ?? '')
    }
    const joined = titles.join(' | ')
    // Accept both locales (the GUI language is a user setting).
    const zhOk = joined.includes('待办') && joined.includes('已完成')
    const enOk = joined.includes('To do') && joined.includes('Done')
    record('column titles', zhOk || enOk, joined)

    // 4) Add a card via the composer.
    await page.fill('.kb-composer input.kb-input >> nth=0', 'GUI 验收新增')
    await page.click('button.kb-primary-btn')
    await page.waitForTimeout(1000)
    const added = await page.locator('.kb-card', { hasText: 'GUI 验收新增' }).count().catch(() => 0)
    record('add card via composer', added >= 1, `${added} card(s)`)

    // 5) Move it to done via the status select.
    const addedCard = page.locator('.kb-card', { hasText: 'GUI 验收新增' }).first()
    await addedCard.locator('select.kb-status-select').selectOption('done').catch(() => {})
    await page.waitForTimeout(1000)
    const doneCol = page.locator('.kb-column[data-status="done"]')
    const inDone = await doneCol.locator('.kb-card', { hasText: 'GUI 验收新增' }).count().catch(() => 0)
    record('move card to done', inDone >= 1, `${inDone} card(s) in done`)

    // 6) Delete the card.
    await doneCol.locator('.kb-card', { hasText: 'GUI 验收新增' }).first()
      .locator('button.kb-mini-btn-danger').click().catch(() => {})
    await page.waitForTimeout(1000)
    const afterDelete = await page.locator('.kb-card', { hasText: 'GUI 验收新增' }).count().catch(() => 0)
    record('delete card', afterDelete === 0, `${afterDelete} remaining`)

    // Close the overlay.
    await page.click('button.kb-icon-btn:has-text("关闭")').catch(() => {})
    await page.waitForTimeout(500)
  }
} catch (error) {
  console.error('acceptance run failed:', error)
  results.push({ name: 'run', ok: false, detail: error.message })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${failed.length === 0 ? '✅ ACCEPTED' : `❌ FAILED (${failed.length}/${results.length})`}`)
process.exit(failed.length === 0 ? 0 : 1)
