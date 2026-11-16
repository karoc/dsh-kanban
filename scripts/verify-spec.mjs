// Verify that note_add honors the workspace's effective Agent Note spec:
// overridden format template + overridden classes + default fallback.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Context, Service } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
const kanban = await import('../lib/index.js')
const { executeTool, installToolExecutor } = await import('./lib/tool-exec.mjs')

class FakeWebServer extends Service {
  constructor(ctx) { super(ctx, 'webServer') }
  register() { return () => {} }
}
class FakeCommands extends Service {
  constructor(ctx) { super(ctx, 'commands') }
  register() { return () => {} }
}

class FakeConnection extends Service {
  constructor(ctx) { super(ctx, 'connection') }
  requestRejection(req) {
    return req.headers['x-test-untrusted'] !== undefined ? 403 : undefined
  }
}

/**
 * The author's LOCAL calendar day as `YYYY-MM-DD`.
 *
 * `note-files.ts` documents the note date as "the local calendar day the note
 * was written", so this gate must derive the expected file name the same way.
 * Using `toISOString()` (UTC) looked for yesterday's file between 00:00 and
 * 08:00 at UTC+8 — the whole suite went red for eight hours a day, and a would-be
 * releaser saw "the gate fails" instead of "the gate is timezone-broken".
 */
function localDate(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `--self-test` proves the assertions below can FAIL (see the end of the file). */
const selfTest = process.argv.includes('--self-test')

const ws = await mkdtemp(join(tmpdir(), 'kanban-spec-'))
// Seed a custom overrides file: custom format template + subset of classes.
await mkdir(join(ws, '.agents', 'notes'), { recursive: true })
await writeFile(join(ws, '.agents', 'notes', 'overrides.json'), JSON.stringify({
  specVersion: 1,
  noteClasses: ['feature', 'architecture'],
  // The self-test seeds a template WITHOUT `## Problem`: the production
  // assertion requires that section, so that run must report a failure. An
  // assertion nobody has seen fail is a print statement, not a gate.
  noteFormat: selfTest
    ? '# Note: {{title}}\n\n## Decision\n\n{{decision}}'
    : '# Note: {{title}}\n\n## Problem\n\n{{problem}}\n\n## Decision\n\n{{decision}}',
}, null, 2), 'utf8')

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await installToolExecutor(ctx)
await ctx.plugin(FakeWebServer)
await ctx.plugin(FakeCommands)
await ctx.plugin(FakeConnection)
await ctx.plugin(kanban)
await new Promise(resolve => setTimeout(resolve, 200))

const agent = { id: 'session-spec-1', session: { header: { cwd: ws } } }
const result = await executeTool(ctx, {
  callId: 'call-spec-1',
  name: 'note_add',
  arguments: {
    class: 'feature',
    topic: 'custom-format',
    problem: 'need custom format',
    decision: 'custom template honored',
  },
  agent,
  signal: new AbortController().signal,
})
const content = result.content?.map(b => b.text).join('') ?? ''
console.log('note_add result:', content)

// The note should be under the overridden class dir and use the custom template.
const notePath = join(ws, '.agents', 'notes', 'implemented', 'feature', `${localDate(new Date())}-custom-format.md`)
const md = await readFile(notePath, 'utf8')
console.log('--- generated note (first lines) ---')
console.log(md.split('\n').slice(0, 12).join('\n'))
const usesCustom = md.startsWith('# Note: custom-format') && md.includes('## Problem')
console.log('uses custom template:', usesCustom)

// Overridden class that is NOT in the effective list must be rejected.
const bad = await executeTool(ctx, {
  callId: 'call-spec-2',
  name: 'note_add',
  arguments: {
    class: 'testing',
    topic: 'rejected-class',
    problem: 'x',
    decision: 'y',
  },
  agent,
  signal: new AbortController().signal,
})
const badContent = bad.content?.map(b => b.text).join('') ?? ''
const rejectedOutOfList = /not in the effective note classes/.test(badContent)
console.log('rejected out-of-list class:', rejectedOutOfList)

await rm(ws, { recursive: true, force: true })

// Both findings used to be PRINTED ONLY: the script exited 0 whether or not the
// plugin honored the spec, so a broken spec seam sailed through `npm test`.
const failures = []
if (!usesCustom) {
  failures.push('note_add did not render the overridden template (missing "# Note: <topic>" or "## Problem")')
}
if (!rejectedOutOfList) {
  failures.push('note_add accepted a class outside the effective noteClasses list (expected a rejection)')
}

if (selfTest) {
  // The self-test seeds a template that omits `## Problem`, so the production
  // assertion MUST fire here. If it does not, the gate is not load-bearing.
  if (failures.length === 0) {
    console.error('❌ SELFTEST FAILED: the spec assertions passed against a template that omits "## Problem" — they cannot fail')
    process.exit(1)
  }
  console.log(`SELFTEST_OK — the assertions failed as intended: ${failures.join('; ')}`)
  process.exit(0)
}

if (failures.length > 0) {
  console.error('❌ SPEC FAILED:')
  for (const failure of failures) console.error(`   - ${failure}`)
  process.exit(1)
}
console.log('SPEC_OK')
