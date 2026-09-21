#!/usr/bin/env node
/**
 * Design-token drift gate (development-time, not shipped to users).
 *
 * WHY: the board page paints with DSH's `--dsw-alias-*` semantic tokens. An
 * unknown custom property does not error — `background: var(--dsw-alias-nope)`
 * is simply invalid at computed-value time, so the surface renders transparent
 * (or, worse, a token with the wrong semantics still resolves and produces
 * unreadable text). Both happened here: `--dsw-alias-bg-module` and
 * `--dsw-alias-bg-input` were never DSH tokens, and
 * `--dsw-alias-interactive-bg-hover-danger` (rgba(...,0.05)) was used as a TEXT
 * color on error/warning lines. Nothing in `tsc` or the runtime catches either.
 * Upstream token renames are therefore invisible until someone looks at the UI.
 *
 * WHAT: every `var(--dsw-alias-<name>)` in src/ must be defined by the DSH
 * theme stylesheets of the INSTALLED runtime (`design-platform.css` holds the
 * alias block for both themes). Non-alias `--dsw-*`/`--ds-*` variables are
 * reported as warnings only, because they are spread across several DSH
 * stylesheets and some are app-level.
 *
 * Failure is proven, not assumed: `--self-test` feeds the detector a fixture
 * containing one known-good and one unknown token and requires exactly the
 * unknown one to be reported. A detector that cannot fail is a fake gate
 * (see CONTRIBUTING.md).
 *
 * Run: node scripts/check-tokens.mjs [--self-test] [--theme <path>]
 * Exit 0 when every used alias token is defined (or when the DSH theme file is
 * unavailable AND --self-test passed — the gate then prints an explicit SKIP
 * line so the coverage gap is visible rather than silent).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const selfTest = args.includes('--self-test')
const themeArg = args.indexOf('--theme')
const failures = []
const warnings = []

/** Scan one text for alias tokens referenced through var(). */
function usedAliasTokens(text) {
  return [...text.matchAll(/var\(\s*(--dsw-alias-[a-z0-9-]+)/g)].map(match => match[1])
}

/** Scan one text for any other DSH custom property referenced through var(). */
function usedOtherDshTokens(text) {
  return [...text.matchAll(/var\(\s*(--(?:dsw|ds)-[a-z0-9-]+)/g)]
    .map(match => match[1])
    .filter(token => !token.startsWith('--dsw-alias-'))
}

/** Every alias the theme file defines (both theme blocks). */
function definedAliasTokens(css) {
  return new Set([...css.matchAll(/(--dsw-alias-[a-z0-9-]+)\s*:/g)].map(match => match[1]))
}

/** Names defined by every DSH stylesheet we can see next to the theme file. */
function definedOtherTokens(dir) {
  const defined = new Set()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.css')) continue
    const css = readFileSync(join(dir, file), 'utf8')
    for (const match of css.matchAll(/(--(?:dsw|ds)-[a-z0-9-]+)\s*:/g)) defined.add(match[1])
  }
  return defined
}

/** Collect every source file under a directory (TypeScript only). */
function sourceFiles(dir) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) found.push(path)
  }
  return found
}

/**
 * Locate the design-platform.css of the runtime DSH the plugin is developed
 * against: an explicit path wins, then the package resolved from this repo's
 * node_modules (the local `@deepseek-ai/*` symlinks), then the shared profile
 * store (~/.dsh/profiles/node_modules).
 */
function findThemeCss() {
  if (themeArg >= 0) {
    const candidate = args[themeArg + 1]
    return candidate !== undefined && existsSync(candidate) ? candidate : undefined
  }
  if (process.env.DSH_THEME_CSS !== undefined) {
    return existsSync(process.env.DSH_THEME_CSS) ? process.env.DSH_THEME_CSS : undefined
  }
  const relative = join('@deepseek-ai', 'dsh-client-ui-theme', 'lib', 'styles', 'design-platform.css')
  const candidates = [
    join(root, 'node_modules', relative),
    join(homedir(), '.dsh', 'profiles', 'node_modules', relative),
  ]
  return candidates.find(candidate => existsSync(candidate))
}

/** Report the tokens in `text` that `defined` does not contain. */
function undefinedTokens(text, defined) {
  return [...new Set(usedAliasTokens(text))].filter(token => !defined.has(token))
}

// 0) The detector itself must be able to fail.
if (selfTest) {
  const defined = new Set(['--dsw-alias-label-primary'])
  const fixture = 'a { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-not-a-token); }'
  const reported = undefinedTokens(fixture, defined)
  if (reported.length !== 1 || reported[0] !== '--dsw-alias-not-a-token') {
    failures.push(`token self-test failed: expected exactly ["--dsw-alias-not-a-token"], got ${JSON.stringify(reported)} — the detector cannot distinguish a bad token, so it is not a gate`)
  }
  const clean = 'a { color: var(--dsw-alias-label-primary); }'
  if (undefinedTokens(clean, defined).length !== 0) {
    failures.push('token self-test failed: a fully defined fixture was reported as undefined (false positive)')
  }
  if (failures.length === 0) console.log('✅ token gate self-test: the detector fails on an unknown token and passes a clean fixture')
}

const themeCss = findThemeCss()
if (themeCss === undefined) {
  console.log('⚠️  SKIP: no DSH theme stylesheet found (looked for node_modules/@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css under the repo and ~/.dsh/profiles). Coverage gap: alias-token existence was NOT checked in this run.')
} else {
  const css = readFileSync(themeCss, 'utf8')
  const aliases = definedAliasTokens(css)
  const other = definedOtherTokens(resolve(themeCss, '..'))
  const occurrences = new Map()
  for (const file of sourceFiles(resolve(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const token of usedAliasTokens(text)) {
      const where = occurrences.get(token) ?? []
      where.push(file.slice(root.length + 1))
      occurrences.set(token, where)
    }
    for (const token of usedOtherDshTokens(text)) {
      if (!other.has(token)) warnings.push(`${token} is used in ${file.slice(root.length + 1)} but not defined by the DSH stylesheets next to ${themeCss}`)
    }
  }
  const missing = [...occurrences.keys()].filter(token => !aliases.has(token)).sort()
  for (const token of missing) {
    failures.push(`unknown design token ${token} (used in ${[...new Set(occurrences.get(token))].join(', ')}) — it resolves to nothing at runtime; pick a token from ${themeCss}`)
  }
  console.log(`token gate: ${occurrences.size} alias token(s) used, ${aliases.size} defined by ${themeCss}`)
  if (missing.length === 0) console.log('✅ every used --dsw-alias-* token is defined by the installed DSH theme')
}

for (const warning of [...new Set(warnings)]) console.log(`⚠️  ${warning}`)
if (failures.length > 0) {
  for (const failure of failures) console.error(`✘ ${failure}`)
  process.exit(1)
}
