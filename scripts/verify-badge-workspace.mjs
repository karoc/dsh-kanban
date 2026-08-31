// Verify the sidebar badge follows workspace switches on the live 3080 GUI.
//
// The bug: the badge resolved its workspace from the workspaces feed's
// recentWorkspaceId (the workspace with the most recently updated session),
// which can stay pinned to another workspace after the user switches, so the
// badge showed the wrong count. The fix resolves from the current session's
// cwd (like the board page) and subscribes to the sessions feed.
//
// Test data on this machine: /srv/jiuta has 4 open cards (badge "4") while
// /home/karoc and /home/karoc/dsh-desktop have 0 (no badge).
//
// Flow: boot -> record badge -> click "jiuta" workspace group -> open a jiuta
// session -> assert badge shows 4 -> switch to "karoc" group -> open a session
// -> assert badge is gone.
import { chromium } from 'playwright'
import { gotoApp } from './gui-auth.mjs'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'
const browser = await chromium.launch()
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function badgeState(page) {
  const el = page.locator('button.kb-sidebar-trigger .kb-badge')
  const n = await el.count()
  if (n === 0) return { text: null, visible: false }
  const text = (await el.first().innerText()).trim()
  return { text, visible: true }
}

async function clickWorkspace(page, title) {
  // Clicking a workspace group row TOGGLES expand/collapse. Only expand when
  // the group is currently collapsed so the target group's sessions show.
  const row = page.locator(`div[role="treeitem"]`).filter({ hasText: title }).first()
  await row.waitFor({ state: 'visible', timeout: 15000 })
  const expanded = await row.getAttribute('aria-expanded')
  if (expanded !== 'true') {
    await row.click()
    await page.waitForTimeout(800)
  }
}

async function openFirstSessionInGroup(page, title, preferFragment) {
  // After clicking the workspace group row it expands and reveals its session
  // rows BELOW the project row. Click a session in this group so `current`
  // becomes a real session in this workspace (rows above the project row
  // belong to the previously active workspace group). When a distinctive
  // title fragment is given, target that row (the sidebar re-arranges between
  // switches, so "first row below" is not stable across runs).
  const projRow = page.locator('div[role="treeitem"]').filter({ hasText: title }).first()
  const projBox = await projRow.boundingBox()
  if (!projBox) throw new Error(`project row "${title}" has no box`)
  let target = null
  if (preferFragment) {
    const frag = page.locator('div.iDujfG_sessionRow').filter({ hasText: preferFragment })
    const n = await frag.count()
    for (let i = 0; i < n; i++) {
      const box = await frag.nth(i).boundingBox()
      if (box && box.y > projBox.y + 8) { target = frag.nth(i); break }
    }
  }
  if (!target) {
    const rows = page.locator('div.iDujfG_sessionRow')
    const n = await rows.count()
    for (let i = 0; i < n; i++) {
      const box = await rows.nth(i).boundingBox()
      if (box && box.y > projBox.y + 8) { target = rows.nth(i); break }
    }
  }
  if (!target) throw new Error(`no session row below project row "${title}"`)
  await target.click()
  await page.waitForTimeout(2500)
  const cur = await page.evaluate(() => {
    const sel = document.querySelector('div.iDujfG_sessionRow.iDujfG_selected')
    return sel ? (sel.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) : null
  })
  console.log(`  [after opening a session in "${title}" group] selected row:`, cur)
  return cur
}

try {
  const page = await browser.newPage()
  page.setDefaultTimeout(20000)
  page.on('pageerror', err => console.log('[pageerror]', err.message))
  page.on('console', msg => { if (msg.type() === 'error') console.log('[console.error]', msg.text()) })
  await gotoApp(page, BASE)
  await page.waitForTimeout(5000)

  const trigger = page.locator('button.kb-sidebar-trigger').first()
  await trigger.waitFor({ state: 'visible', timeout: 15000 })
  console.log('boot badge:', JSON.stringify(await badgeState(page)))

  // --- Switch to jiuta (4 open) ---
  await clickWorkspace(page, 'jiuta')
  await openFirstSessionInGroup(page, 'jiuta', '理解 H1 修复执行计划')
  const jiutaBadge = await badgeState(page)
  record('after switching to jiuta, badge shows 4', jiutaBadge.visible && jiutaBadge.text === '4', JSON.stringify(jiutaBadge))
  await page.screenshot({ path: '/tmp/kb-badge-jiuta.png' })

  // --- Switch to karoc (0 open) ---
  await clickWorkspace(page, 'karoc')
  await openFirstSessionInGroup(page, 'karoc')
  const karocBadge = await badgeState(page)
  record('after switching to karoc, badge is hidden (0 open)', !karocBadge.visible, JSON.stringify(karocBadge))
  await page.screenshot({ path: '/tmp/kb-badge-karoc.png' })

  // --- Switch back to jiuta again (repeatability) ---
  await clickWorkspace(page, 'jiuta')
  await openFirstSessionInGroup(page, 'jiuta', '理解 H1 修复执行计划')
  const jiutaAgain = await badgeState(page)
  record('switch back to jiuta shows 4 again', jiutaAgain.visible && jiutaAgain.text === '4', JSON.stringify(jiutaAgain))
} catch (err) {
  console.error('VERIFY FAILED:', err.message)
  results.push({ name: 'script ran to completion', ok: false, detail: err.message })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length > 0 ? 1 : 0)
