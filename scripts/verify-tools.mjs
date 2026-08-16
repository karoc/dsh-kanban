// Manual smoke check for the host half: boot systemPrompt + ToolRuntime +
// FakeWebServer + kanban on a bare cordis context, then verify the 4 board
// tools register AND that board_add executes end-to-end (cwd from the owning
// agent's session → KANBAN.json on disk).
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

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await ctx.plugin(FakeWebServer)
await ctx.plugin(kanban)
// Let service proxies settle.
await new Promise(resolve => setTimeout(resolve, 200))

// 1) The four board tools are registered with valid schemas.
const schemas = ctx.tools.schemas()
const board = schemas.map(s => s.name).filter(n => n.startsWith('board_'))
console.log('board tools:', board.join(', '))
if (board.length !== 4) {
  console.error('expected 4 board tools')
  process.exit(1)
}

// 2) board_add executes end-to-end: the owning agent's session cwd resolves the
// workspace and the card lands in <cwd>/KANBAN.json.
const ws = await mkdtemp(join(tmpdir(), 'kanban-exec-'))
const fakeAgent = {
  id: 'session-verify-1',
  session: { header: { cwd: ws } },
}
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
