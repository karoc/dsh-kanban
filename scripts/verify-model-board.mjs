// Real model tool-call verification: ask the GUI agent to use board_add then
// board_list, then report what appears in the conversation and on disk.
// Run: node scripts/verify-model-board.mjs
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
// The board is written to the SESSION's cwd (usually the GUI host's working
// directory / home), not to a fixed project dir. Discovery: after the model
// runs board_add, search the likely roots for the fresh KANBAN.json.
const SEARCH_ROOTS = [
  process.env.HOME ?? '/home/karoc',
  '/srv/deepseek-harness',
]
const TITLE = `模型工具验收-${Date.now().toString(36)}`

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  const textarea = page.locator('textarea[placeholder*="Describe"], textarea').first()
  await textarea.waitFor({ state: 'visible', timeout: 15000 })
  await textarea.click()
  await textarea.fill(
    `用 board_add 工具把一张卡片「${TITLE}」记进当前工作区的看板，tags 用 [验收]。`
    + `然后用 board_list 确认并告诉我看板里现在有几张卡片、标题是什么。`,
  )
  await page.keyboard.press('Enter')
  console.log('message sent, waiting for model...')

  // Poll the conversation for up to 5 minutes.
  let found = false
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    if (body.includes(TITLE)) { found = true; break }
  }
  console.log('model referenced the card title:', found)

  // Check on disk whether the card landed (search the likely session-cwd roots).
  let onDisk = false
  let diskPath = ''
  for (const root of SEARCH_ROOTS) {
    const candidate = join(root, 'KANBAN.json')
    try {
      const raw = await readFile(candidate, 'utf8')
      const board = JSON.parse(raw)
      if (board.cards?.some(c => c.title === TITLE)) {
        onDisk = true
        diskPath = candidate
        break
      }
    } catch { /* keep searching */ }
  }
  console.log(onDisk
    ? `board card landed on disk at ${diskPath}`
    : 'board card NOT found on disk under search roots')

  const body = await page.evaluate(() => document.body.innerText)
  const mentions = ['board_add', 'board_list', 'KANBAN', TITLE].filter(w => body.includes(w))
  console.log('conversation evidence:', mentions.join(', '))
  console.log('tail:', body.slice(-500).replace(/\n+/g, ' | '))

  console.log(found && onDisk ? 'MODEL_TOOL_OK' : 'MODEL_TOOL_MISSING')
} finally {
  await browser.close()
}
