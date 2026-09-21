// Verify the session-start board snapshot on the real 3080: ask the model to
// list the workspace's open board items WITHOUT calling any tool. If the
// auto-injection works on the restarted host, it answers from context.
//
// [2026-09-08] Base now reads DSH_GUI_URL (token handshake like the other
// scripts). [2026-09-21] Two changes so the check stops going stale and stops
// writing into the user's own sessions: the expected titles are READ from the
// target workspace's KANBAN.json at run time (a hardcoded title went stale every
// time the board changed), and the probe is sent from a NEWLY created session in
// that workspace instead of an existing row (which is usually the session the
// user is working in).
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { gotoApp } from './gui-auth.mjs'

/** Workspace whose board injection is under test (the demo board on this machine). */
const WORKSPACE_DIR = '/home/karoc/dsh-kanban'

/** Open (todo / in_progress) card titles the injected snapshot must contain. */
async function openTitles(dir) {
  const board = JSON.parse(await readFile(join(dir, 'KANBAN.json'), 'utf8'))
  return board.cards
    .filter(card => card.status === 'todo' || card.status === 'in_progress')
    .map(card => card.title)
}
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  await gotoApp(page, process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080')
  await page.waitForTimeout(5000)

  // Expected titles come from the board on disk (never hardcoded).
  const expected = await openTitles(WORKSPACE_DIR)
  if (expected.length === 0) throw new Error(`${WORKSPACE_DIR}/KANBAN.json has no open cards — nothing to assert against`)
  console.log(`expecting ${expected.length} open card(s) in the snapshot`)

  // Send the probe from a NEW session: the injection under test reads the
  // session's workspace board, and a fresh session keeps the probe out of the
  // user's own conversation.
  // Case-insensitive: the shell labels it "New Session" (wide) / "New session"
  // depending on locale revision, and "新建会话" in Chinese.
  const newSession = page.locator('button[aria-label*="new session" i], button[aria-label*="新建"]').first()
  await newSession.waitFor({ state: 'visible', timeout: 15000 })
  await newSession.click()
  await page.waitForTimeout(3000)

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
    // Stop as soon as the model echoes any expected title (or the last one).
    if (expected.some(title => body.includes(title))) {
      replied = body
      break
    }
    replied = body
  }
  const matched = expected.filter(title => replied.includes(title))
  const hasBoardNames = matched.length > 0
  console.log(`titles reproduced from context: ${matched.length}/${expected.length}`)
  const idx = replied.lastIndexOf('不要调用任何工具')
  const answer = idx >= 0 ? replied.slice(idx, idx + 900) : '(no answer captured)'
  console.log('model answered board items without tools:', hasBoardNames)
  console.log('--- reply snippet ---')
  console.log(answer.replace(/\n+/g, ' | ').slice(0, 800))
} finally { await browser.close() }
