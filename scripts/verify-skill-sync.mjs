#!/usr/bin/env node
/**
 * Verify the skill self-heal installation (host half):
 *   - missing target  → the shipped SKILL.md is copied in
 *   - identical target → no-op (content unchanged, no second write)
 *   - differing target → the local copy is KEPT (user edit protection) and
 *     a warning is printed instead of clobbering
 * Runs against the BUILT lib (pnpm bundle first) so it exercises the exact
 * import.meta.url-based source path the host process uses.
 * Run: node scripts/verify-skill-sync.mjs
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ensureSkillInstalled, skillSourceFile, skillTargetFile } = await import('../lib/index.js')

const sourceText = await readFile(skillSourceFile(), 'utf8')
const home = await mkdtemp(join(tmpdir(), 'kanban-skill-'))
const target = skillTargetFile(home)

let ok = true
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!cond) ok = false
}

// 1. Missing → installed with the shipped content.
await ensureSkillInstalled(home)
const first = await readFile(target, 'utf8').catch(() => '')
check('missing → installed', first === sourceText)
if (first === sourceText) console.log('   (startup log would print: kanban-use skill installed to …)')

// 2. Identical → no-op (content unchanged; and skip the "differs" branch).
const mtimeBefore = (await import('node:fs')).statSync(target).mtimeMs
await new Promise(resolve => setTimeout(resolve, 20))
await ensureSkillInstalled(home)
const second = await readFile(target, 'utf8')
const mtimeAfter = (await import('node:fs')).statSync(target).mtimeMs
check('identical → no rewrite', second === sourceText && mtimeAfter === mtimeBefore)

// 3. Differing → local copy kept.
const custom = '# My own kanban skill\n'
await writeFile(target, custom, 'utf8')
let warned = false
const originalWarn = console.warn
console.warn = (message) => { warned = true; console.log(`   (startup log would warn: ${String(message).slice(0, 60)}…)`) }
await ensureSkillInstalled(home)
console.warn = originalWarn
const kept = await readFile(target, 'utf8')
check('differing → local copy kept', kept === custom && warned)

await rm(home, { recursive: true, force: true })
console.log(ok ? 'SKILL_SYNC_OK' : 'SKILL_SYNC_FAIL')
process.exit(ok ? 0 : 1)