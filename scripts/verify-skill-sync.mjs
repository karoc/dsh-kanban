#!/usr/bin/env node
/**
 * Verify the skill self-heal installation (host half) — five states:
 *   1. missing                          → shipped SKILL.md copied in
 *   2. identical                        → no-op (no rewrite, mtime stable)
 *   3. same skill-version, differs      → local copy KEPT (user edit) + warn
 *   4. older/absent skill-version       → synced over (stale package content
 *      from a previous install — the upgrade path)
 *   5. higher skill-version             → local copy KEPT (user-managed) + warn
 * Runs against the BUILT lib (pnpm bundle first) so it exercises the exact
 * import.meta.url-based source path the host process uses.
 * Run: node scripts/verify-skill-sync.mjs
 */
import { statSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { ensureSkillInstalled, skillSourceFile, skillTargetFile } = await import('../lib/index.js')

const sourceText = await readFile(skillSourceFile(), 'utf8')
const sourceVersion = (sourceText.slice(0, 400).match(/^skill-version:\s*(\d+)\s*$/m) ?? [])[1] ?? '?'
const home = await mkdtemp(join(tmpdir(), 'kanban-skill-'))

let ok = true
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!cond) ok = false
}

const sync = async () => ensureSkillInstalled(home)

// 1. Missing → installed with the shipped content.
await sync()
const first = await readFile(skillTargetFile(home), 'utf8').catch(() => '')
check('missing → installed', first === sourceText)

// 2. Identical → no-op (no rewrite at all).
const mtimeBefore = statSync(skillTargetFile(home)).mtimeMs
await new Promise(resolve => setTimeout(resolve, 20))
await sync()
check('identical → no rewrite', statSync(skillTargetFile(home)).mtimeMs === mtimeBefore)

// 3. Same version, different content → kept (user edit) + warned.
const custom = `---\nname: kanban-use\nskill-version: ${sourceVersion}\n---\n# my edit\n`
await writeFile(skillTargetFile(home), custom, 'utf8')
let warned = false
const originalWarn = console.warn
console.warn = (m) => { warned = true }
await sync()
console.warn = originalWarn
check('same-version edit → kept + warned', (await readFile(skillTargetFile(home), 'utf8')) === custom && warned)

// 4. Older/absent version (pre-fingerprint copy from an old install) → synced.
const stale = '# 0.2.0-era skill without a version fingerprint\n'
await writeFile(skillTargetFile(home), stale, 'utf8')
await sync()
check('stale version → synced to shipped', (await readFile(skillTargetFile(home), 'utf8')) === sourceText)

// 5. Higher version → kept (user manages their own future skill) + warned.
const future = `---\nname: kanban-use\nskill-version: ${Number(sourceVersion) + 99}\n---\n# my future skill\n`
await writeFile(skillTargetFile(home), future, 'utf8')
warned = false
console.warn = (m) => { warned = true }
await sync()
console.warn = originalWarn
check('higher version → kept + warned', (await readFile(skillTargetFile(home), 'utf8')) === future && warned)

await rm(home, { recursive: true, force: true })
console.log(ok ? 'SKILL_SYNC_OK' : 'SKILL_SYNC_FAIL')
process.exit(ok ? 0 : 1)