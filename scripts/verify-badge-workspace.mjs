// Verify the sidebar badge follows workspace switches on the live 3080 GUI.
//
// The original bug: the badge resolved its workspace from the workspaces
// feed's recentWorkspaceId (the workspace with the most recently updated
// session), which can stay pinned to another workspace after the user
// switches, so the badge showed the wrong count. The fix resolves from the
// current session's cwd (like the board page) and subscribes to the sessions
// feed. Since DSH removed `recentWorkspaceId` from the WorkspaceSnapshot, the
// no-current-session fallback derives the most-recently-active workspace from
// the workspaces + sessions feeds (client-side `recentWorkspaceId`, mirroring
// ui-workspace's `recentWorkspace`).
//
// Flow: boot -> record badge -> switch to workspace A -> open one of its
// sessions -> assert the glyph badge equals A's open-card count -> switch to
// workspace B -> assert B's count -> switch back to A -> assert A's count
// again (repeatability).
//
// The expected counts are READ FROM each workspace's KANBAN.json at run time,
// not hardcoded: earlier revisions pinned the live numbers and went stale every
// time a board changed (jiuta=4/karoc=0 → desktop=2/kanban=1 → …), which turns
// a product check into a fixture-maintenance chore. The two workspaces must
// still have DIFFERENT open counts for the switch to be observable — the script
// fails loudly when they do not.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { gotoApp } from './gui-auth.mjs'

const BASE = process.env.DSH_GUI_URL ?? 'http://127.0.0.1:3080'

/** The two workspaces this check switches between (distinct open counts required). */
const WORKSPACE_A = { title: 'dsh-desktop', dir: '/home/karoc/dsh-desktop' }
const WORKSPACE_B = { title: 'dsh-kanban', dir: '/home/karoc/dsh-kanban' }

/** Open-card count of a workspace's board, or undefined when it has no board. */
async function openCardCount(dir) {
  try {
    const board = JSON.parse(await readFile(join(dir, 'KANBAN.json'), 'utf8'))
    return board.cards.filter(card => card.status === 'todo' || card.status === 'in_progress').length
  } catch {
    return undefined
  }
}
const browser = await chromium.launch()
const results = []
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function badgeState(page) {
  const el = page.locator('button:has(.kb-panel-icon) .kb-panel-badge')
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

  const trigger = page.locator('button:has(.kb-panel-icon)').first()
  await trigger.waitFor({ state: 'visible', timeout: 15000 })
  console.log('boot badge:', JSON.stringify(await badgeState(page)))

  // Expected badges come from the boards on disk, so the check never goes stale.
  const expectedA = await openCardCount(WORKSPACE_A.dir)
  const expectedB = await openCardCount(WORKSPACE_B.dir)
  console.log(`expected badges: ${WORKSPACE_A.title}=${String(expectedA)} ${WORKSPACE_B.title}=${String(expectedB)}`)
  if (expectedA === undefined || expectedB === undefined || expectedA === expectedB) {
    record('the two workspaces have distinct open-card counts', false, `${WORKSPACE_A.title}=${String(expectedA)} ${WORKSPACE_B.title}=${String(expectedB)} — the switch would not be observable`)
  } else {
    record('the two workspaces have distinct open-card counts', true, `${WORKSPACE_A.title}=${expectedA} ${WORKSPACE_B.title}=${expectedB}`)

    // --- Switch to workspace A ---
    await clickWorkspace(page, WORKSPACE_A.title)
    await openFirstSessionInGroup(page, WORKSPACE_A.title)
    const badgeA = await badgeState(page)
    record(`after switching to ${WORKSPACE_A.title}, badge shows ${expectedA}`, badgeA.visible && badgeA.text === String(expectedA), JSON.stringify(badgeA))
    await page.screenshot({ path: `/tmp/kb-badge-${WORKSPACE_A.title}.png` })

    // --- Switch to workspace B ---
    await clickWorkspace(page, WORKSPACE_B.title)
    await openFirstSessionInGroup(page, WORKSPACE_B.title)
    const badgeB = await badgeState(page)
    record(`after switching to ${WORKSPACE_B.title}, badge shows ${expectedB}`, badgeB.visible && badgeB.text === String(expectedB), JSON.stringify(badgeB))
    await page.screenshot({ path: `/tmp/kb-badge-${WORKSPACE_B.title}.png` })

    // --- Switch back to A again (repeatability) ---
    await clickWorkspace(page, WORKSPACE_A.title)
    await openFirstSessionInGroup(page, WORKSPACE_A.title)
    const badgeAAgain = await badgeState(page)
    record(`switch back to ${WORKSPACE_A.title} shows ${expectedA} again`, badgeAAgain.visible && badgeAAgain.text === String(expectedA), JSON.stringify(badgeAAgain))
  }
} catch (err) {
  console.error('VERIFY FAILED:', err.message)
  results.push({ name: 'script ran to completion', ok: false, detail: err.message })
} finally {
  await browser.close()
}

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length > 0 ? 1 : 0)
