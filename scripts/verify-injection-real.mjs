// Verify the session-start board snapshot reaches a real model: ask it to
// list the workspace's open board items WITHOUT calling any tool. If the
// auto-injection works, the model answers from context (no tool calls).
import { chromium } from 'playwright'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  await page.goto('http://127.0.0.1:3199', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const ta = page.locator('textarea').first()
  await ta.waitFor({ state: 'visible', timeout: 15000 })
  await ta.click()
  await ta.fill('不要调用任何工具（不要 board_list）。直接回答：根据你当前上下文里已经注入的信息，我当前工作区的看板上现在有哪些未完成（todo / in_progress）的卡片？逐条列出标题即可。')
  await page.keyboard.press('Enter')
  console.log('sent; waiting for model reply...')
  // Wait for a reply (up to ~3 min). Detect by textarea becoming empty + assistant text appearing.
  let replied = ''
  for (let i = 0; i < 36; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    if (body.includes('看板插件开发') && (body.includes('待办-下一步') || body.includes('当前阶段'))) {
      replied = body
      break
    }
  }
  const hasBoardNames = replied.includes('待办-下一步') || replied.includes('当前阶段')
  const idx = replied.lastIndexOf('不要调用任何工具')
  const answer = idx >= 0 ? replied.slice(idx, idx + 800) : '(no answer captured)'
  console.log('model answered with board item titles without tools:', hasBoardNames)
  console.log('--- reply snippet ---')
  console.log(answer.replace(/\n+/g, ' | ').slice(0, 700))
} finally { await browser.close() }
