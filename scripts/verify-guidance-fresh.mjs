// Fresh-session verification: create a new session, send a multi-step plan
// request WITHOUT mentioning the board, and check the model proactively calls
// board_add (system-prompt guidance). Run on a fresh temp instance.
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3199'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0,200)) })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  // Click New Session to get a blank session
  const newBtn = page.locator('button', { hasText: /New Session|新建/ }).first()
  await newBtn.click().catch(() => {})
  await page.waitForTimeout(2000)
  const textarea = page.locator('textarea').first()
  await textarea.waitFor({ state: 'visible', timeout: 15000 })
  await textarea.click()
  // Ask for a plan WITHOUT mentioning the board at all.
  await textarea.fill(
    '我要做一个 Markdown 转 HTML 的命令行工具：词法分析、AST、渲染、CLI 入口、测试。'
    + '请先列出计划，然后按计划实现，每完成一步更新一下任务状态。',
  )
  await page.keyboard.press('Enter')
  console.log('sent (no board mention); watching...')
  // Poll for board_add tool call for up to 6 min
  let sawBoard = false
  let sawDone = false
  for (let i = 0; i < 72; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    if (!sawBoard && body.includes('board_add')) {
      sawBoard = true
      console.log(`t+${((i+1)*5).toFixed(0)}s: model called board_add`)
    }
    if (!sawDone && (body.includes('Waiting for answer') === false)) {
      // only consider done after we've seen progress; keep sampling
    }
  }
  const body = await page.evaluate(() => document.body.innerText)
  const idx = body.indexOf('Markdown')
  console.log('=== final conversation ===')
  console.log(body.slice(Math.max(0, idx-50), idx+2500).replace(/\n+/g, ' | '))
  // Disk check
  try {
    const raw = await readFile(join('/home/karoc', 'KANBAN.json'), 'utf8')
    const b = JSON.parse(raw)
    console.log('KANBAN.json cards:', (b.cards ?? []).map(c => `${c.title}(${c.status})`).join(', ') || '(empty)')
  } catch (e) { console.log('KANBAN.json:', e.code ?? e.message) }
  console.log('RESULT proactive board_add:', sawBoard)
} finally { await browser.close() }
