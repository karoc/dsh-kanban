// Verify the enhanced note_add guidance: ask a real model to write an Agent
// Note and check the generated content is DSH-depth (negative guarantees,
// real alternatives with why, cost+bought consequences), not a shallow summary.
import { chromium } from 'playwright'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

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
  await ta.fill('请用 note_add 写一篇 Agent Note，记录「看板卡片删除增加二次确认（Modal）」这个功能变更。class 用 feature，topic 用 card-delete-confirm。要求：Decision 写清具体实现（Modal、confirmDelete state、onClose/确认路径）和负向保证（什么不会误删）；Alternatives 写真实放弃的备选和原因；Consequences 写代价和收益。')
  await page.keyboard.press('Enter')
  console.log('sent; waiting for model to write the note...')
  let done = false
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    if (body.includes('card-delete-confirm') && body.includes('Agent Note written')) { done = true; break }
  }
  console.log('note written:', done)
  // Read the generated note
  const dir = join('/home/karoc/.agents/notes/implemented', 'feature')
  let found = ''
  try {
    const files = await readdir(dir)
    const target = files.filter(f => f.includes('card-delete-confirm')).sort().at(-1)
    if (target) found = await readFile(join(dir, target), 'utf8')
  } catch {}
  console.log('=== generated note ===')
  console.log(found.slice(0, 1600))
  // Depth heuristics
  const hasNegative = /not done|NOT done|不会|不.*删除|never|is not|does not/i.test(found)
  const hasAltWhy = /why not|放弃|rejected because|because|失配|落选|because it/i.test(found)
  const hasCostBuy = /cost|代价|bought|收益|trade-off|换来/i.test(found)
  const hasPresentTense = /is |are |ships|stores|renders|uses /i.test(found)
  console.log('=== depth heuristics ===')
  console.log('negative guarantees:', hasNegative)
  console.log('alternatives with why:', hasAltWhy)
  console.log('cost+bought consequences:', hasCostBuy)
  console.log('present-tense concrete decision:', hasPresentTense)
} finally { await browser.close() }
