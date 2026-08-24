// Live-GUI verification of the card-completeness UI: open the board page on
// the running dsh web (3080), add a TITLE-ONLY card via the composer, assert
// the missing-field warning line (.kb-card-missing) appears, then delete the
// card (confirm modal) so the board is left exactly as it was.
// Run: node scripts/verify-completeness-ui.mjs
import { chromium } from 'playwright'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
const TITLE = `完整度提示验证-${Date.now().toString(36)}`

const browser = await chromium.launch()
let passed = 0
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); if (cond) passed += 1; else passed -= 1 }
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // Open the board page from the sidebar footer entry (rail mode has no
  // visible label — the trigger carries it in aria-label).
  const nav = page.locator('.kb-sidebar-trigger').first()
  await nav.waitFor({ state: 'visible', timeout: 15000 })
  await nav.click()
  const board = page.locator('.kb-overlay[data-testid="kanban-page"]').first()
  await board.waitFor({ state: 'visible', timeout: 15000 })
  ok('board page opens', await board.isVisible())

  // Add a title-only card through the composer.
  const titleInput = page.locator('.kb-raw-title, input').first()
  const composerInput = page.locator('.kb-composer input').first()
  await composerInput.waitFor({ state: 'visible', timeout: 10000 })
  await composerInput.fill(TITLE)
  await page.locator('.kb-composer button', { hasText: /Add|新增/ }).first().click()
  await page.waitForTimeout(1500)

  const card = page.locator('.kb-card', { hasText: TITLE }).first()
  await card.waitFor({ state: 'visible', timeout: 10000 })
  ok('title-only card appears', await card.isVisible())

  const missing = card.locator('.kb-card-missing').first()
  await missing.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  const text = (await missing.textContent().catch(() => '')) ?? ''
  // Locale-agnostic: en "missing: Why" / zh "缺字段：为什么".
  ok(`missing-field hint shown (${text.trim()})`, text.includes('Why') || text.includes('为什么'))

  // Delete the test card (trash + confirm modal). The confirm Modal is
  // portaled to body, so the confirm button is a page-level match by text.
  await card.locator('button[aria-label*="Remove"], button[aria-label*="删除"]').first().click()
  await page.waitForTimeout(500)
  const confirm = page.locator('button', { hasText: /^Delete$|^删除$/ }).last()
  await confirm.click().catch(() => {})
  await page.waitForTimeout(1000)
  ok('test card removed', (await page.locator('.kb-card', { hasText: TITLE }).count()) === 0)

  console.log(passed === 4 ? 'COMPLETENESS_UI_OK' : 'COMPLETENESS_UI_FAIL')
  process.exit(passed === 4 ? 0 : 1)
} finally {
  await browser.close()
}