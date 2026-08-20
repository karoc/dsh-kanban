// Verify the kanban UX improvements on the live 3080 GUI:
//  1. The three what/why/rejected fields clamp to two lines with an ellipsis.
//  2. Clicking the title + fields region opens the detail dialog (formatted,
//     full content, status/tags, timestamps), and it closes again.
//  3. A silent auto-refresh cycle does NOT move the user's scroll position nor
//     flash a loading state (the fix for "refresh drops my reading position").
// The board's workspace is read from the live header (it flips between runs),
// and temporary cards are seeded into that exact board, then removed.
import { chromium } from 'playwright'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
const API = `${BASE}/kanban/api`

const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const LONG_SUMMARY = '第一行：这是一段很长的“做了什么”内容，用来验证卡片上最多只显示两行。'.repeat(6)
const LONG_WHY = '第二段很长的“为什么”内容：包含换行。\n第二行\n第三行，超出两行以后应当被截断并显示省略号，而详情弹窗里应该完整展示。'.repeat(3)
const LONG_REJ = '第三段很长的“放弃了什么”内容，同样应该在卡片预览里被两行截断，详情里完整展示。'.repeat(4)

async function post(cwd, body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cwd, ...body }),
  })
  const json = await res.json()
  if (!json.ok) throw new Error(JSON.stringify(json))
  return json
}

const browser = await chromium.launch()
let cwd = undefined
const addedIds = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', err => console.log('[pageerror]', err.message))
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text())
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  const kanbanButton = page.locator('button.kb-sidebar-trigger').first()
  await kanbanButton.waitFor({ state: 'visible', timeout: 15000 })
  await kanbanButton.click()
  await page.waitForTimeout(1200)

  const overlay = page.locator('.kb-overlay').first()
  await overlay.waitFor({ state: 'visible', timeout: 10000 })

  // Detect the board file path + GUI locale from the header sub line. The
  // header shows the KANBAN.json file path; the API needs the workspace dir.
  const headerSub = await page.locator('.kb-header-sub').first().innerText()
  const pathMatch = headerSub.match(/(?:Board file|看板文件):\s*(\S+)/)
  const boardFile = pathMatch ? pathMatch[1] : undefined
  cwd = boardFile !== undefined ? boardFile.replace(/\/[^/]+$/, '') : undefined
  if (cwd === undefined) throw new Error(`could not parse board path from header: ${headerSub}`)
  console.log(`board: ${boardFile} (workspace ${cwd})`)
  const isEn = headerSub.startsWith('Board file')
  const labels = isEn
    ? { what: 'What', why: 'Why', rej: 'Rejected', desc: 'Description', created: 'Created', refresh: /Refresh|刷新/ }
    : { what: '做了什么', why: '为什么', rej: '放弃了什么', desc: '描述', created: '创建于', refresh: /刷新|Refresh/ }

  // Seed long-content cards into the resolved board so the todo column
  // overflows and scrolls; capture each card's exact id by its unique title.
  for (let i = 0; i < 6; i++) {
    const title = `UX 测试卡 ${i + 1}（长内容，用于两行截断与滚动验证）`
    const json = await post(cwd, { op: 'add', title, summary: LONG_SUMMARY, rationale: LONG_WHY, rejected: LONG_REJ, tags: ['ux-test'] })
    const mine = json.cards.find(c => c.title === title)
    addedIds.push(mine.id)
  }
  const target = addedIds[0]

  // Manual refresh (locale-agnostic button text) to pull the seeds in.
  await page.locator('.kb-header button').filter({ hasText: labels.refresh }).first().click()
  await page.waitForTimeout(1500)

  const card = page.locator(`.kb-card[data-card-id="${target}"]`)
  await card.waitFor({ state: 'visible', timeout: 10000 })

  // --- 1) two-line clamp on the three fields ---
  const fields = card.locator('.kb-card-field')
  const fieldCount = await fields.count()
  record('card shows the three what/why/rejected fields', fieldCount === 3, `count=${fieldCount}`)
  if (fieldCount === 3) {
    let allClamped = true
    const clampInfo = []
    for (let i = 0; i < fieldCount; i++) {
      const style = await fields.nth(i).evaluate(el => {
        const s = getComputedStyle(el)
        return {
          lineClamp: s.webkitLineClamp,
          height: Math.round(el.getBoundingClientRect().height),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          overflow: s.overflow,
        }
      })
      const clamped = style.lineClamp === '2'
        && style.overflow === 'hidden'
        && style.scrollHeight > style.clientHeight
      if (!clamped) allClamped = false
      clampInfo.push(JSON.stringify(style))
    }
    record('every field clamps to 2 lines with ellipsis (line-clamp + overflow + clipped)', allClamped, clampInfo.join(' | '))
  }

  // --- 2) detail dialog via the title+fields trigger region ---
  const hit = card.locator('.kb-card-hit')
  record('card has a clickable hit region (title + fields)', await hit.count() === 1)
  await hit.click()
  await page.waitForTimeout(400)
  const dialog = page.locator('[role="dialog"]')
  let dialogOpen = false
  try {
    await dialog.waitFor({ state: 'visible', timeout: 5000 })
    dialogOpen = true
  } catch { /* noop */ }
  record('clicking the content region opens the detail dialog', dialogOpen)

  if (dialogOpen) {
    const dlg = dialog.first()
    const dlgText = await dlg.innerText()
    const hasTitle = dlgText.includes('UX 测试卡 1')
    const hasStatus = dlgText.includes('To do') || dlgText.includes('待办')
    const hasTag = dlgText.includes('ux-test')
    const hasFullSummary = dlgText.includes(LONG_SUMMARY)
    const hasFullWhy = dlgText.includes('第三行，超出两行以后应当被截断并显示省略号')
    const hasLabels = dlgText.includes(labels.what) && dlgText.includes(labels.why) && dlgText.includes(labels.rej)
    const hasCreated = dlgText.includes(labels.created)
    record('dialog shows title + status + tags', hasTitle && hasStatus && hasTag)
    record('dialog shows FULL (unclamped) field content', hasFullSummary && hasFullWhy)
    record('dialog shows labeled sections + created time', hasLabels && hasCreated)
    await dlg.locator('.kb-detail-close').click()
    await page.waitForTimeout(300)
    const stillOpen = await dialog.isVisible().catch(() => false)
    record('dialog closes via its close button', !stillOpen)
  }

  // --- 3) silent auto-refresh preserves scroll ---
  const scrollColumn = page.locator('.kb-column[data-status="todo"] .kb-column-cards')
  await scrollColumn.evaluate(el => { el.scrollTop = 120 })
  await page.waitForTimeout(300)
  const before = await scrollColumn.evaluate(el => el.scrollTop)
  const headerBefore = await page.locator('.kb-header-sub').first().innerText()
  const loadingFlash = await page.locator('.kb-loading').count()
  record('todo column is scrollable (scrolled to offset)', before > 0, `scrollTop=${before}`)

  await page.waitForTimeout(17000)
  const after = await scrollColumn.evaluate(el => el.scrollTop)
  const loadingAfter = await page.locator('.kb-loading').count()
  const headerAfter = await page.locator('.kb-header-sub').first().innerText()
  record('scroll position survives a silent refresh cycle', after === before, `${before} -> ${after}`)
  record('no loading flash during the silent refresh', loadingFlash === 0 && loadingAfter === 0)
  record('the silent poll actually ran (header time advanced)', headerAfter !== headerBefore, `${headerBefore} | ${headerAfter}`)

  // Keyboard accessibility: focus the hit region and press Enter.
  await hit.focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const reopened = await page.locator('[role="dialog"]').isVisible().catch(() => false)
  record('detail opens with keyboard (Enter on focused region)', reopened)
  if (reopened) {
    await page.locator('[role="dialog"] .kb-detail-close').click().catch(() => {})
  }
} catch (err) {
  console.error('VERIFY FAILED:', err.message)
} finally {
  for (const id of addedIds) {
    try { if (cwd !== undefined) await post(cwd, { op: 'remove', id }) } catch { /* already gone */ }
  }
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length > 0 ? 1 : 0)
