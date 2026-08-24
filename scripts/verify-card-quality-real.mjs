#!/usr/bin/env node
/**
 * Real-model behavioral regression for the card-completeness discipline.
 *
 * Drives the live GUI (3080) with a REAL model: asks it to plan a multi-step
 * task and record each step with board_add, explicitly requiring rationale
 * (为什么) and rejected (放弃了什么) where a decision was made. Then reads the
 * card JSON on disk and asserts every new card carries a rationale — the
 * deterministic lever shipped in 0.2.0 (guidance + tool descriptions) proven
 * end-to-end through an actual model, not a unit test.
 *
 * Cleanup: every test card (title starting with the MARK prefix) is removed
 * through POST /kanban/api so the board is left exactly as it was.
 *
 * Run: node scripts/verify-card-quality-real.mjs   (GUI must be up; takes 2-8 min)
 */
import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
const MARK = `验收-${Date.now().toString(36)}`

const browser = await chromium.launch()
let failed = false
const report = (name, ok, detail = '') => console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` (${detail})` : ''}`)
try {
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('[pageerror]', e.message))
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)
  const ta = page.locator('textarea').first()
  await ta.waitFor({ state: 'visible', timeout: 20000 })
  await ta.click()
  await ta.fill(
    '我要做一个 Git 提交信息规范化小工具：表单校验、自动生成 CHANGELOG 条目、CLI 入口三部分。'
    + `请用 board_add 把这几个步骤记进看板（不要用 todo_write），标题以「${MARK}」开头；`
    + '每张卡片必须写 rationale（为什么做/为什么现在做）；有"决定不做某方案"的取舍就写 rejected。'
    + '全部记完后用 board_list 展示看板路径。',
  )
  await page.keyboard.press('Enter')
  console.log('sent; waiting for the model to board_add + board_list...')

  // Poll the conversation (up to 8 min) for board_list output with the board path.
  let boardPath = ''
  for (let i = 0; i < 96; i++) {
    await page.waitForTimeout(5000)
    const body = await page.evaluate(() => document.body.innerText)
    const m = body.match(/Board at (\S+KANBAN\.json)/)
    if (m !== null && m[1] !== '') {
      boardPath = m[1].replace(/\\/g, '/')
      console.log(`   saw board path at t+${((i + 1) * 5).toFixed(0)}s: ${boardPath}`)
      break
    }
  }
  report('model used board_add and printed the board path', boardPath !== '', boardPath)

  if (boardPath !== '') {
    const board = JSON.parse(await readFile(boardPath, 'utf8'))
    const mine = board.cards.filter(c => c.title.startsWith(MARK))
    report('model created cards with the expected prefix', mine.length > 0, `${mine.length} card(s)`)
    const withWhy = mine.filter(c => (c.rationale ?? '').trim() !== '')
    report(`every test card carries rationale (为什么)`, mine.length > 0 && withWhy.length === mine.length,
      `${withWhy.length}/${mine.length}`)
    for (const card of mine) {
      const why = (card.rationale ?? '').replace(/\n+/g, ' ').slice(0, 60)
      const rej = (card.rejected ?? '').replace(/\n+/g, ' ').slice(0, 60)
      console.log(`   - [${card.status}] ${card.title}\n     为什么: ${why || '(空)'}${rej ? `\n     放弃了: ${rej}` : ''}`)
    }
    if (withWhy.length < mine.length) failed = true

    // Cleanup: remove every test card via the host route (same file the tools write).
    const cwd = dirname(boardPath)
    for (const card of mine) {
      const ok = await page.evaluate(async ({ cwd, id }) => {
        const res = await fetch('/kanban/api', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cwd, op: 'remove', id }),
        })
        const body = await res.json()
        return res.ok && body.ok === true
      }, { cwd, id: card.id })
      console.log(`   cleanup ${card.title}: ${ok ? 'removed' : 'FAILED'}`)
      if (!ok) failed = true
    }
  } else {
    failed = true
  }

  console.log(failed ? 'CARD_QUALITY_REAL_FAIL' : 'CARD_QUALITY_REAL_OK')
  process.exit(failed ? 1 : 0)
} finally {
  await browser.close()
}