// Verify the session-start board snapshot on the real 3080: ask the model to
// list the workspace's open board items WITHOUT calling any tool. If the
// auto-injection works on the restarted host, it answers from context.
//
// [2026-09-08] Base now reads DSH_GUI_URL (token handshake like the other
// scripts); the asserted card titles follow the live workspace board — the
// current /home/karoc/dsh-kanban board carries one open card whose title
// starts with "DSH 0.1.3-alpha.1 兼容核查". The script first opens a session
// in the dsh-kanban workspace group (the GUI keeps the previously selected
// session, so without this the injection under test could target another
// workspace). Keep the assertion in sync with the machine's board data.
import { chromium } from 'playwright'
import { gotoApp } from './gui-auth.mjs'
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  await gotoApp(page, process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080')
  await page.waitForTimeout(5000)

  // Select a session in the dsh-kanban workspace group so the injection under
  // test reads THIS workspace's board.
  const group = page.locator('div[role="treeitem"]').filter({ hasText: 'dsh-kanban' }).first()
  await group.waitFor({ state: 'visible', timeout: 15000 })
  if ((await group.getAttribute('aria-expanded')) !== 'true') {
    await group.click()
    await page.waitForTimeout(800)
  }
  const groupBox = await group.boundingBox()
  if (!groupBox) throw new Error('dsh-kanban group has no box')
  const rows = page.locator('div.iDujfG_sessionRow')
  const n = await rows.count()
  let session = null
  for (let i = 0; i < n; i++) {
    const box = await rows.nth(i).boundingBox()
    if (box && box.y > groupBox.y + 8) { session = rows.nth(i); break }
  }
  if (!session) throw new Error('no session row under the dsh-kanban group')
  await session.click()
  await page.waitForTimeout(2500)

  const ta = page.locator('textarea, [contenteditable="true"]').first()
  await ta.waitFor({ state: 'visible', timeout: 15000 })
  await ta.click()
  await ta.fill('不要调用任何工具（不要 board_list）。直接回答：根据你当前上下文里已经注入的信息，我当前工作区的看板上现在有哪些未完成（todo / in_progress）的卡片？逐条列出标题即可。')
  await page.keyboard.press('Enter')
  console.log('sent; waiting for model reply...')
  let replied = ''
  for (let i = 0; i < 36; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    if (body.includes('0.1.3-alpha.1 兼容核查')) {
      replied = body
      break
    }
  }
  const hasBoardNames = replied.includes('0.1.3-alpha.1 兼容核查')
  const idx = replied.lastIndexOf('不要调用任何工具')
  const answer = idx >= 0 ? replied.slice(idx, idx + 900) : '(no answer captured)'
  console.log('model answered board items without tools:', hasBoardNames)
  console.log('--- reply snippet ---')
  console.log(answer.replace(/\n+/g, ' | ').slice(0, 800))
} finally { await browser.close() }
