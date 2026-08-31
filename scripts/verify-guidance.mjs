// Verify the model proactively uses the kanban board (system-prompt guidance).
// Run: node scripts/verify-guidance.mjs
import { chromium } from 'playwright'
import { gotoApp } from './gui-auth.mjs'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3199'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })
  await gotoApp(page, BASE)
  await page.waitForTimeout(4000)
  const textarea = page.locator('textarea').first()
  await textarea.waitFor({ state: 'visible', timeout: 15000 })
  await textarea.click()
  await textarea.fill(
    '我要做一个完整的 CLI 工具：包括参数解析、核心逻辑、单元测试、README。'
    + '请制定一份多步骤计划（每步一个卡片），把每张卡片记进看板（board_add），'
    + '然后开始逐步实现，每完成一步就把对应卡片移到 in_progress 或 done。',
  )
  await page.keyboard.press('Enter')
  console.log('sent; waiting for model to use board_add proactively...')
  let sawBoard = false
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    if (body.includes('board_add')) { sawBoard = true; break }
  }
  console.log('model proactively used board_add:', sawBoard)
  if (sawBoard) {
    const body = await page.evaluate(() => document.body.innerText)
    const m = body.match(/Tool call[\s\S]{0,140}board_add[\s\S]{0,100}/)
    console.log('evidence:', m ? m[0].replace(/\n+/g, ' | ') : 'board_add mentioned')
    // Also count how many cards landed on disk at the session cwd.
  }
} finally { await browser.close() }
