#!/usr/bin/env node
/**
 * Negative controls for this repo's gates: a gate nobody has seen FAIL is not
 * evidence. Every scenario below clones the committed tree into a temp dir,
 * injects ONE defect, runs the gate that is supposed to catch it, and asserts
 * the gate FAILS with the expected message. A scenario that passes (or that
 * fails for the wrong reason) fails this script.
 *
 * Why: this plugin owns the user KANBAN.json — "cards are archived, never
 * deleted", "a broken file fails loud" — and a promise that is never exercised
 * is a rumour. Manual one-off proofs decay; this re-proves the gates each run.
 *
 * Offline-friendly: DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE=1 is set so the
 * release gate's registry probe cannot turn the positive control red.
 */
import { execFileSync, execSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseCheckFailures, undocumentedReleaseFailures } from './lib/release-post-state.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const TAG = `v${VERSION}`

/** Fresh clone of the committed tree, with the (gitignored) build output copied in. */
function freshClone() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-kanban-control-'))
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', root, dir], { stdio: 'ignore' })
  if (!existsSync(join(root, 'lib/index.js'))) {
    console.error('❌ negative controls need a built artifact — run `npm run bundle` first')
    process.exit(1)
  }
  cpSync(join(root, 'lib'), join(dir, 'lib'), { recursive: true })
  return dir
}

/** Run a command inside the clone; never throws. */
function run(dir, command) {
  try {
    return { code: 0, output: execSync(command, { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE: '1' } }) }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const scenarios = [
  {
    name: 'dirty working tree',
    command: 'node scripts/release-check.mjs',
    expect: /working tree is not clean/,
    mutate: (dir) => appendFileSync(join(dir, 'README.md'), '\n<!-- uncommitted -->\n'),
  },
  {
    name: 'CHANGELOG entry for the current version removed',
    command: 'node scripts/release-check.mjs',
    expect: new RegExp(`CHANGELOG\\.md has no entry for \\[${VERSION.replace(/\./g, '\\.')}\\]`),
    mutate: (dir) => {
      const p = join(dir, 'CHANGELOG.md')
      writeFileSync(p, readFileSync(p, 'utf8').replace(new RegExp(`^## \\[${VERSION.replace(/\./g, '\\.')}\\].*$`, 'm'), ''))
    },
  },
  {
    name: 'release tag deleted',
    command: 'node scripts/release-check.mjs',
    expect: new RegExp(`git tag ${TAG} does not exist`),
    mutate: (dir) => execFileSync('git', ['tag', '-d', TAG], { cwd: dir, stdio: 'ignore' }),
  },
  {
    name: 'build artifact removed',
    command: 'node scripts/release-check.mjs',
    expect: /is missing — run `npm run bundle` first/,
    mutate: (dir) => rmSync(join(dir, 'lib/index.js')),
  },
  {
    name: 'done column ordered by createdAt instead of updatedAt',
    command: 'node --test scripts/board-view.spec.mjs',
    expect: /the most recently completed card must be first in done/,
    mutate: (dir) => {
      const p = join(dir, 'src/client/board-view.ts')
      const before = readFileSync(p, 'utf8')
      const after = before.replace(
        'const byUpdated = right.updatedAt - left.updatedAt',
        'const byUpdated = right.createdAt - left.createdAt',
      )
      // A no-op mutation would make this scenario pass for the wrong reason.
      if (after === before) throw new Error('mutation did not apply — the updatedAt comparator is not in src/client/board-view.ts')
      writeFileSync(p, after)
    },
  },
  {
    name: 'card description clamp removed from the stylesheet',
    command: 'node --test scripts/board-view.spec.mjs',
    expect: /the description must be clamped to two lines/,
    mutate: (dir) => {
      const p = join(dir, 'src/client/styles.ts')
      const before = readFileSync(p, 'utf8')
      const after = before.replace(/-webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n}\n\.kb-card-fields/, '-webkit-line-clamp: unset;\n  -webkit-box-orient: vertical;\n  overflow: visible;\n}\n.kb-card-fields')
      if (after === before) throw new Error('mutation did not apply — the .kb-card-desc clamp block is not in src/client/styles.ts')
      writeFileSync(p, after)
    },
  },
  {
    name: 'trust fence loses its host-generation guard (DSH 0.2.x route regression)',
    command: 'node --test scripts/routes.spec.mjs',
    expect: /connection\.requestRejection is not a function/,
    // The scenario runs a spec against the built bundle, and the spec
    // resolves @deepseek-ai/* — which `git clone` does not carry. The symlink
    // is per-scenario on purpose: a `node_modules` symlink in the POSITIVE
    // control's clone is not ignored by git's `node_modules/` rule (that
    // pattern matches directories, and a symlink is not one), so release-check
    // would see a dirty tree and the positive control would fail for the wrong
    // reason.
    usesModules: true,
    mutate: (dir) => {
      const p = join(dir, 'lib/index.js')
      const before = readFileSync(p, 'utf8')
      const after = before.replace('typeof connection.requestRejection === "function"', 'true')
      if (after === before) throw new Error('mutation did not apply — the requestRejection guard is not in lib/index.js')
      writeFileSync(p, after)
    },
  },
  {
    name: 'guarantee row loses its pinning assertion',
    command: 'node scripts/check-guarantees.mjs',
    expect: /no test title matches/,
    mutate: (dir) => {
      const p = join(dir, 'docs/guarantees.md')
      const before = readFileSync(p, 'utf8')
      const after = before.replace(/`readBoard fails loud on invalid JSON`/, '`an assertion that does not exist`')
      // A no-op mutation would make this scenario pass for the wrong reason.
      if (after === before) throw new Error('mutation did not apply — the anchor is not in docs/guarantees.md')
      writeFileSync(p, after)
    },
  },
]

let failed = 0
console.log('▶ positive control — an unmutated clone must PASS both gates')
{
  const dir = freshClone()
  const release = run(dir, 'node scripts/release-check.mjs')
  const guarantees = run(dir, 'node scripts/check-guarantees.mjs')
  rmSync(dir, { recursive: true, force: true })
  // A PUBLISHED version (and the tag that then sits behind HEAD) fails
  // release-check by design; only the documented items may explain a non-zero
  // exit, and any other failure item means the clone is broken.
  const documented = releaseCheckFailures(release.output).length
  const undocumented = undocumentedReleaseFailures(release.output)
  const releaseOk = release.code === 0 || (documented > 0 && undocumented.length === 0)
  const ok = releaseOk && guarantees.code === 0
  console.log(`${ok ? '  ✅' : '  ❌'} release-check exit=${release.code}, guarantee gate exit=${guarantees.code}`)
  if (!ok) {
    failed += 1
    console.log(`     release tail: ${release.output.trim().split('\n').slice(-3).join(' | ')}`)
    console.log(`     guarantees tail: ${guarantees.output.trim().split('\n').slice(-2).join(' | ')}`)
  }
  if (ok) console.log(`     (release-check: ${release.output.trim().split('\n').pop()})`)
}

for (const scenario of scenarios) {
  const dir = freshClone()
  let result
  try {
    scenario.mutate(dir)
    if (scenario.usesModules === true) {
      try { symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir') } catch { /* already there or unsupported */ }
    }
    result = run(dir, scenario.command)
  } catch (error) {
    result = { code: 0, output: `mutation threw: ${error.message}` }
  }
  rmSync(dir, { recursive: true, force: true })
  const caught = result.code !== 0 && scenario.expect.test(result.output)
  console.log(`${caught ? '✅' : '❌'} ${scenario.name}`)
  if (!caught) {
    failed += 1
    console.log(`     exit=${result.code} expected ${scenario.expect}`)
    console.log(`     output: ${result.output.trim().split('\n').slice(0, 3).join(' | ')}`)
  }
}

if (failed > 0) {
  console.error(`\n❌ ${failed} negative control(s) failed — a gate is not load-bearing as documented`)
  process.exit(1)
}
console.log(`\n✅ all ${scenarios.length} negative controls + the positive control behaved as documented`)
