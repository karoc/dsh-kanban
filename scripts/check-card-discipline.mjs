#!/usr/bin/env node
/**
 * Card-discipline static gate (development-time, not shipped to users).
 *
 * All surfaces that teach the model "what a complete card is" must agree:
 *   1. the system-prompt guidance (src/index.ts BOARD_GUIDANCE) names the
 *      three what/why/rejected fields and the incomplete-card rule;
 *   2. the board_add / board_update tool descriptions carry the same rule;
 *   3. board-core.ts exports the shared completeness predicate
 *      (missingCardFields) so the tool render, session snapshot, and any
 *      audit apply ONE rule;
 *   4. the kanban-use skill ships with the plugin (skills/kanban-use/SKILL.md),
 *      references the six tools, and teaches the same three fields, and
 *      src/index.ts points the model at it ("load it when it is available").
 *
 * Why static: the real-model verification scripts (verify-guidance*,
 * verify-note-depth*) prove BEHAVIOR on a live instance; this gate proves the
 * INSTRUCTIONS stayed intact through edits. Run: node scripts/check-card-discipline.mjs
 * Exit 0 when every assertion holds.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const fail = (message) => failures.push(message)

const index = readFileSync(resolve(root, 'src', 'index.ts'), 'utf8')
const core = readFileSync(resolve(root, 'src', 'board-core.ts'), 'utf8')

// 1. Guidance names the three fields + the incomplete-card rule + the skill.
for (const needle of [
  '为什么', '放弃了什么', '做了什么',
  'title-only card is an incomplete card',
  'do not close a card without its three fields',
  'kanban-use skill',
]) {
  if (!index.includes(needle)) fail(`BOARD_GUIDANCE (src/index.ts) no longer mentions "${needle}" — keep the card-completeness contract in the guidance`)
}

// 2. Tool descriptions carry the rule.
if (!index.includes('title-only card is incomplete and is flagged as 缺')) {
  fail('board_add description lost the incomplete-card warning — restore "title-only card is incomplete"')
}
if (!index.includes('make it self-explanatory with all three fields')) {
  fail('board_update description lost the close-card three-fields rule — restore "self-explanatory with all three fields"')
}

// 3. The shared completeness predicate exists (same rule every surface uses).
if (!core.includes('export function missingCardFields')) {
  fail('board-core.ts lost missingCardFields — the tool render / snapshot / audit rely on it')
}
if (!core.includes('export const CARD_FIELD_LABELS')) {
  fail('board-core.ts lost CARD_FIELD_LABELS — model-visible renders rely on it')
}

// 4. The skill ships, is well-formed, and teaches the same contract.
const skillPath = resolve(root, 'skills', 'kanban-use', 'SKILL.md')
if (!existsSync(skillPath)) {
  fail('skills/kanban-use/SKILL.md is missing — the guidance points at the kanban-use skill')
} else {
  const skill = readFileSync(skillPath, 'utf8')
  if (!/^---\nname: kanban-use/m.test(skill)) {
    fail('SKILL.md frontmatter must declare name: kanban-use (exact) so sessions can load it')
  }
  for (const tool of ['board_list', 'board_add', 'board_update', 'board_remove', 'note_add', 'note_list']) {
    if (!skill.includes(tool)) fail(`kanban-use SKILL.md must reference the ${tool} tool`)
  }
  for (const field of ['为什么', '做了什么', '放弃了什么']) {
    if (!skill.includes(field)) fail(`kanban-use SKILL.md must teach the ${field} card field (same semantics as CARD_FIELD_LABELS)`)
  }
  if (!/^skill-version:\s*\d+\s*$/m.test(skill.slice(0, 400))) {
    fail('kanban-use SKILL.md frontmatter must carry a numeric skill-version — bump it when the skill content changes (the host self-heal uses it to distinguish "stale package copy" from "user edit")')
  }
}

// 5. The skill is installable (the installer script is part of the contract).
if (!existsSync(resolve(root, 'scripts', 'install-skill.mjs'))) {
  fail('scripts/install-skill.mjs is missing — the skill must be installable into ~/.agents/skills')
}

if (failures.length > 0) {
  console.error('❌ card-discipline gate FAILED:')
  for (const f of failures) console.error(`   - ${f}`)
  console.error('\nEvery surface (guidance, tool descriptions, shared predicate, skill) must teach the same card-completeness contract.')
  process.exit(1)
}
console.log('✅ card-discipline gate passed: guidance, tool descriptions, shared predicate, and kanban-use skill are consistent.')