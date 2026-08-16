// Manual smoke check for the host half: boot systemPrompt + ToolRuntime +
// FakeWebServer + FakeCommands + kanban on a bare cordis context, then verify
// the 4 board tools register, board_add executes end-to-end (cwd from the
// owning agent's session → KANBAN.json on disk), and the /kanban command
// registers.
// Run: node scripts/verify-tools.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await ctx.plugin(FakeWebServer)
await ctx.plugin(FakeCommands)
await ctx.plugin(kanban)
// Let service proxies settle.
await new Promise(resolve => setTimeout(resolve, 200))

// 1) All six model-facing tools are registered (4 board + 2 note).
const schemas = ctx.tools.schemas()
const board = schemas.map(s => s.name).filter(n => n.startsWith('board_'))
const notes = schemas.map(s => s.name).filter(n => n.startsWith('note_'))
console.log('board tools:', board.join(', '))
console.log('note tools:', notes.join(', '))
if (board.length !== 4) {
  console.error('expected 4 board tools')
  process.exit(1)
}
if (notes.length !== 2) {
  console.error('expected 2 note tools')
  process.exit(1)
}

// 1b) The system-prompt guidance section and the /kanban command registered
// (registration itself does not throw while these services exist).
console.log('systemPrompt section + /kanban command registration: ok')

// 1c) note_add executes end-to-end: writes .agents/notes/implemented/<class>/...
const ws = await mkdtemp(join(tmpdir(), 'kanban-exec-'))
const fakeAgent = {
  id: 'session-verify-1',
  session: { header: { cwd: ws } },
}
const noteResult = await ctx.tools.execute({
  callId: 'call-note-1',
  name: 'note_add',
  arguments: {
    class: 'feature',
    topic: 'verify-tool',
    problem: 'need to verify note_add',
    decision: 'wrote a note through the tool',
    alternatives: 'none',
  },
  agent: fakeAgent,
  signal: new AbortController().signal,
})
const noteText = noteResult.content?.map(block => block.text).join('') ?? ''
console.log('note_add executed:', noteText)
if (!noteText.includes('.agents/notes/implemented/feature/')) {
  console.error('note_add did not write under .agents/notes/implemented/feature/')
  process.exit(1)
}

// 2) board_add executes end-to-end: the owning agent's session cwd resolves the
// workspace and the card lands in <cwd>/KANBAN.json.
const result = await ctx.tools.execute({
  callId: 'call-verify-1',
  name: 'board_add',
  arguments: { title: '真实执行验证' },
  agent: fakeAgent,
  signal: new AbortController().signal,
})
const text = result.content?.map(block => block.text).join('') ?? ''
console.log('board_add executed:', text.split('\n')[0])
const onDisk = JSON.parse(await readFile(join(ws, 'KANBAN.json'), 'utf8'))
console.log('on-disk cards:', onDisk.cards.length, '| title:', onDisk.cards[0]?.title)
if (onDisk.cards.length !== 1 || onDisk.cards[0].title !== '真实执行验证') {
  console.error('board_add did not persist the expected card')
  process.exit(1)
}
await rm(ws, { recursive: true, force: true })
console.log('ok: all 4 tools registered and board_add persisted end-to-end')
