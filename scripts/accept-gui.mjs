/**
 * GUI acceptance for the dsh-kanban plugin against the live Web GUI
 * (http://127.0.0.1:3080). Uses playwright's chromium (already installed).
 *
 * Checks:
 *  1. The sidebar footer shows the 「看板」 entry (a native primitives Button).
 *  2. Clicking it opens the full-screen board page with an OPAQUE background.
 *  3. The three columns (todo / in_progress / done) render.
 *  4. Adding a card through the composer works and persists.
 *  5. Moving a card to done (via the status Menu) works.
 *  6. Deleting a card works.
 *
 * Run: node scripts/accept-gui.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', err => console.log('  [pageerror]', err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [console.error]', msg.text())
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  // Let the web client boot its plugin tree.
  await page.waitForTimeout(4000)

  // 1) Sidebar footer 「看板」 entry — a native primitives Button.
  const kanbanButton = page.locator('button.kb-sidebar-trigger').first()
  try {
    await kanbanButton.waitFor({ state: 'visible', timeout: 15000 })
    record('sidebar 「看板」 entry visible', true)
  } catch {
    record('sidebar 「看板」 entry visible', false, 'button.kb-sidebar-trigger not found')
  }

  // 1b) It matches the Settings footer trigger (34px compact row, 12px radius,
  // left-aligned) and carries an icon.
  if (await kanbanButton.isVisible().catch(() => false)) {
    const style = await kanbanButton.evaluate(el => {
      const s = getComputedStyle(el)
      return { height: s.height, radius: s.borderRadius, font: s.fontSize, padLeft: s.paddingLeft }
    })
    const matchesTrigger = style.height === '34px' && style.radius === '12px' && style.font === '14px' && style.padLeft === '10px'
    const hasIcon = await kanbanButton.locator('svg').count()
    record('sidebar entry matches the Settings trigger (left-aligned + icon)', matchesTrigger && hasIcon >= 1, JSON.stringify(style) + ` icon=${hasIcon}`)
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
    // 2b) The overlay is OPAQUE (styles loaded) — not transparent.
    const bg = await overlay.evaluate(el => getComputedStyle(el).backgroundColor).catch(() => '')
    const opaque = bg !== '' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent'
    record('board page has an opaque background', opaque, bg)

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

    // 4) Add a card via the composer (primitives Input + primary Button).
    await page.locator('.kb-composer input').first().fill('GUI 验收新增')
    await page.locator('.kb-composer button').first().click()
    await page.waitForTimeout(1000)
    const added = await page.locator('.kb-card', { hasText: 'GUI 验收新增' }).count().catch(() => 0)
    record('add card via composer', added >= 1, `${added} card(s)`)

    // 5) Move it to done via the status Menu (button → menu item "Done"/"已完成").
    const addedCard = page.locator('.kb-card', { hasText: 'GUI 验收新增' }).first()
    let moved = false
    try {
      await addedCard.locator('button').first().click()
      await page.waitForTimeout(600)
      const item = page.locator('[role=menuitem]').filter({ hasText: /Done|已完成/ }).first()
      await item.waitFor({ state: 'visible', timeout: 5000 })
      await item.click()
      await page.waitForTimeout(1000)
      const inDone = await page.locator('.kb-column[data-status="done"] .kb-card', { hasText: 'GUI 验收新增' }).count().catch(() => 0)
      moved = inDone >= 1
    } catch { /* fall through */ }
    record('move card to done via menu', moved)

    // 6) Delete the card (ghost icon button with aria-label).
    const doneCard = page.locator('.kb-column[data-status="done"] .kb-card', { hasText: 'GUI 验收新增' }).first()
    let deleted = false
    try {
      await doneCard.locator('button[aria-label="Remove"], button[aria-label="删除"]').click()
      await page.waitForTimeout(1000)
      const afterDelete = await page.locator('.kb-card', { hasText: 'GUI 验收新增' }).count().catch(() => 0)
      deleted = afterDelete === 0
    } catch { /* fall through */ }
    record('delete card', deleted)

    // Close the overlay.
    await page.locator('button.kb-header .kb-header-spacer').first().count().catch(() => 0)
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
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
