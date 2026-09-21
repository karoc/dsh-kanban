#!/usr/bin/env node
/**
 * DEVELOPMENT-TIME spec sync check (not shipped to users).
 *
 * The Agent Note spec in `src/note-spec.ts` is replicated from the
 * deepseek-harness repo (it is NOT importable — `scripts/verify-agent-note-format.ts`
 * is a repo-internal script, not published or installable). This script reads the
 * LOCAL deepseek-harness checkout and compares its spec constants against the
 * plugin's defaults, so when upstream changes the format/classes you know to sync.
 *
 * Upstream anchor (source of truth):
 *   - note classes:     <dsh>/scripts/agent-note-tree.ts        -> AGENT_NOTE_CLASSES
 *   - note format:      <dsh>/scripts/verify-agent-note-format.ts -> # Agent Note: / Status / REQUIRED
 *   - note scope rule:  <dsh>/.agents/notes/README.md            -> "When to write one"
 *     (a root AGENTS.md sentence used to carry it; that line is now a pointer)
 *   - checked at commit: ddefc45fbc7f8e46dd73185e68295696d1297887
 *
 * Usage: node scripts/check-note-spec.mjs [path-to-dsh-repo]
 * Exit 0 when in sync (or only expected re-wordings); 1 when upstream changed.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DSH_ROOT = process.argv[2] ?? '/srv/deepseek-harness'
const PLUGIN_SPEC = resolve(import.meta.dirname, '..', 'src', 'note-spec.ts')

/** Grab the exported array literal for one const in a TS file. */
function arrayLiteral(source, name) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\[[^;]*?\\])\\s*as const`, 's'))
  if (!m) throw new Error(`cannot find ${name} in upstream source`)
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
}

const errors = []
const notes = []
const report = (ok, what, detail) => {
  if (ok) notes.push(`ok   ${what}${detail ? ` — ${detail}` : ''}`)
  else errors.push(`DIFF ${what}${detail ? ` — ${detail}` : ''}`)
}

// ── Upstream constants ─────────────────────────────────────────────────────
const treeSrc = readFileSync(resolve(DSH_ROOT, 'scripts', 'agent-note-tree.ts'), 'utf8')
const formatSrc = readFileSync(resolve(DSH_ROOT, 'scripts', 'verify-agent-note-format.ts'), 'utf8')
const agentsMd = readFileSync(resolve(DSH_ROOT, 'AGENTS.md'), 'utf8')
const notesReadme = readFileSync(resolve(DSH_ROOT, '.agents', 'notes', 'README.md'), 'utf8')

const upstreamClasses = arrayLiteral(treeSrc, 'AGENT_NOTE_CLASSES')

// Format anchors: title prefix, implemented REQUIRED sections, banned headings.
const hasTitlePrefix = /# Agent Note:/.test(formatSrc)
const implementedRequired = (() => {
  const m = formatSrc.match(/REQUIRED:\s*Record<string, string\[\]> = \{[\s\S]*?implemented: (\[[^\]]*\])/)
  if (!m) return []
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
})()
const bannedImplemented = /Proposal\b/.test(formatSrc)

// Note-scope anchors. The rule lives in .agents/notes/README.md ("When to write
// one"); AGENTS.md keeps a one-line pointer to it and the paragraph must exist.
const scopeAnchors = [
  'When to write one',
  'lasting decision rationale that code, tests, and existing documentation do not explain',
  'Mechanical or local edits',
  'do not create a duplicate',
]
const missingScopeAnchors = scopeAnchors.filter(anchor => !notesReadme.includes(anchor))
const agentsPointerAnchor = 'durable decision rationale'
const upstreamHasNonTrivial = missingScopeAnchors.length === 0 && agentsMd.includes(agentsPointerAnchor)

// ── Plugin constants ────────────────────────────────────────────────────────
const pluginSrc = readFileSync(PLUGIN_SPEC, 'utf8')
const pluginClasses = arrayLiteral(pluginSrc, 'DEFAULT_NOTE_CLASSES')
const pluginHasTitlePrefix = /# Agent Note:/.test(pluginSrc)
const pluginNonTrivial = pluginSrc.includes('NON-TRIVIAL')
const pluginScopeAnchors = [
  'cross-file or cross-package',
  'lasting decision rationale',
  'Mechanical or local edits',
  'do not create a duplicate',
]
const pluginMissingScopeAnchors = pluginScopeAnchors.filter(anchor => !pluginSrc.includes(anchor))

// ── Compare ────────────────────────────────────────────────────────────────
report(
  JSON.stringify(upstreamClasses) === JSON.stringify(pluginClasses),
  'note classes match upstream',
  `upstream=${upstreamClasses.join(',')} plugin=${pluginClasses.join(',')}`,
)
report(
  hasTitlePrefix === pluginHasTitlePrefix,
  'title prefix (# Agent Note:) matches',
  `upstream=${hasTitlePrefix} plugin=${pluginHasTitlePrefix}`,
)
report(
  implementedRequired.includes('## Decision') && pluginSrc.includes('## Decision'),
  'implemented requires ## Decision',
)
report(
  implementedRequired.includes('## Consequences') && pluginSrc.includes('## Consequences'),
  'implemented requires ## Consequences',
)
report(
  bannedImplemented && pluginSrc.includes('Proposal') === false,
  'banned headings (Proposal/Plan/…) excluded from template',
)
report(
  upstreamHasNonTrivial,
  'upstream states the note-scope rule (notes README) with AGENTS.md pointing at it',
  missingScopeAnchors.length === 0
    ? `AGENTS.md pointer="${agentsPointerAnchor}"`
    : `missing from .agents/notes/README.md: ${missingScopeAnchors.join(' | ')}`,
)
report(
  pluginNonTrivial && pluginMissingScopeAnchors.length === 0,
  'plugin non-trivial definition re-states the upstream rule (re-worded)',
  pluginMissingScopeAnchors.length === 0
    ? undefined
    : `missing from src/note-spec.ts: ${pluginMissingScopeAnchors.join(' | ')}`,
)

console.log(`Checking Agent Note spec against dsh repo: ${DSH_ROOT}`)
console.log('Upstream commit: ddefc45fbc7f8e46dd73185e68295696d1297887')
for (const n of notes) console.log(n)
if (errors.length > 0) {
  console.log('\n⚠️  Upstream changed — sync src/note-spec.ts defaults (then bump NOTE_SPEC_VERSION).')
  for (const e of errors) console.log('  ' + e)
  process.exit(1)
}
console.log('\nIn sync with upstream spec.')
