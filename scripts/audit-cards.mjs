#!/usr/bin/env node
/**
 * Audit a workspace's KANBAN.json for incomplete cards under the
 * card-completeness discipline (the same rule the plugin enforces everywhere):
 *   - every card must carry rationale (为什么) — a title-only card is incomplete;
 *   - a done card must be self-explanatory: summary (做了什么) + rationale +
 *     rejected (放弃了什么) all present.
 * An open card may legitimately lack summary (nothing done yet) and rejected
 * (no decision made yet).
 *
 * Reports every incomplete card with what it is missing. Exit 0 with a clean
 * board (or only warnings); `--fail` exits 1 when any card is incomplete
 * (for CI / release gates).
 *
 * Usage: node scripts/audit-cards.mjs [workspace-path] [--fail]
 * Default workspace: the repo root (how the dsh-kanban board is audited).
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const failMode = args.includes('--fail')
const workspace = resolve(process.cwd(), args.find(a => a !== '--fail') ?? '.')
const boardPath = resolve(workspace, 'KANBAN.json')

const FIELD_LABELS = { summary: '做了什么', rationale: '为什么', rejected: '放弃了什么' }

/** Which of the three what/why/rejected fields a card is missing (mirror of
 * board-core.missingCardFields — kept local so the audit runs without the
 * built lib). */
function missingFields(card) {
  const missing = []
  if (card.rationale === undefined || String(card.rationale).trim() === '') missing.push('rationale')
  if (card.status === 'done') {
    if (card.summary === undefined || String(card.summary).trim() === '') missing.push('summary')
    if (card.rejected === undefined || String(card.rejected).trim() === '') missing.push('rejected')
  }
  return missing
}

if (!existsSync(boardPath)) {
  console.log(`audit-cards: no KANBAN.json at ${boardPath} — nothing to audit.`)
  process.exit(0)
}

let board
try {
  board = JSON.parse(readFileSync(boardPath, 'utf8'))
} catch (error) {
  console.error(`audit-cards: ${boardPath} is not valid JSON: ${error.message}`)
  process.exit(1)
}
if (board.version !== 1 || !Array.isArray(board.cards)) {
  console.error(`audit-cards: ${boardPath} does not match the KANBAN.json shape`)
  process.exit(1)
}

const incomplete = board.cards
  .map(card => ({ card, missing: missingFields(card) }))
  .filter(entry => entry.missing.length > 0)

console.log(`audit-cards: ${board.cards.length} card(s) at ${boardPath}`)
if (incomplete.length === 0) {
  console.log('✅ all cards are complete (rationale on every card; three what/why/rejected fields on every done card).')
  process.exit(0)
}

for (const { card, missing } of incomplete) {
  const fields = missing.map(field => FIELD_LABELS[field]).join('、')
  console.log(`  ⚠️ [${card.status}] ${card.title} — 缺:${fields}`)
}
if (failMode) {
  console.error(`❌ ${incomplete.length} incomplete card(s) — fill the missing 为什么 / 做了什么 / 放弃了什么 fields first.`)
  process.exit(1)
}
console.log(`⚠️ ${incomplete.length} incomplete card(s) (report only; re-run with --fail to block).`)
process.exit(0)