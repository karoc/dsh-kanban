// Verify that note_add honors the workspace's effective Agent Note spec:
// overridden format template + overridden classes + default fallback.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Context, Service } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
const kanban = await import('../lib/index.js')

class FakeWebServer extends Service {
  constructor(ctx) { super(ctx, 'webServer') }
  register() { return () => {} }
}
class FakeCommands extends Service {
  constructor(ctx) { super(ctx, 'commands') }
  register() { return () => {} }
}

const ws = await mkdtemp(join(tmpdir(), 'kanban-spec-'))
// Seed a custom overrides file: custom format template + subset of classes.
await mkdir(join(ws, '.agents', 'notes'), { recursive: true })
await writeFile(join(ws, '.agents', 'notes', 'overrides.json'), JSON.stringify({
  specVersion: 1,
  noteClasses: ['feature', 'architecture'],
  noteFormat: '# Note: {{title}}\n\n## Problem\n\n{{problem}}\n\n## Decision\n\n{{decision}}',
}, null, 2), 'utf8')

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await ctx.plugin(FakeWebServer)
await ctx.plugin(FakeCommands)
await ctx.plugin(kanban)
await new Promise(resolve => setTimeout(resolve, 200))

const agent = { id: 'session-spec-1', session: { header: { cwd: ws } } }
const result = await ctx.tools.execute({
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
const notePath = join(ws, '.agents', 'notes', 'implemented', 'feature', `${new Date().toISOString().slice(0, 10)}-custom-format.md`)
const md = await readFile(notePath, 'utf8')
console.log('--- generated note (first lines) ---')
console.log(md.split('\n').slice(0, 12).join('\n'))
const usesCustom = md.startsWith('# Note: custom-format') && md.includes('## Problem')
console.log('uses custom template:', usesCustom)

// Overridden class that is NOT in the effective list must be rejected.
const bad = await ctx.tools.execute({
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
console.log('rejected out-of-list class:', /not in the effective note classes/.test(badContent))

await rm(ws, { recursive: true, force: true })
console.log(usesCustom ? 'SPEC_OK' : 'SPEC_FAIL')
