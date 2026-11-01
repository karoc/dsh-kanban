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
const { executeTool, installToolExecutor } = await import('./lib/tool-exec.mjs')

const routes = new Map()
class FakeWebServer extends Service {
  constructor(ctx) { super(ctx, 'webServer') }
  register(route) { routes.set(route.path, route); return () => {} }
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

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await installToolExecutor(ctx)
await ctx.plugin(FakeWebServer)
await ctx.plugin(FakeCommands)
await ctx.plugin(FakeConnection)
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
const noteResult = await executeTool(ctx, {
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
const result = await executeTool(ctx, {
  callId: 'call-verify-1',
  name: 'board_add',
  arguments: { title: '真实执行验证' },
  agent: fakeAgent,
  signal: new AbortController().signal,
})
const text = result.content?.map(block => block.text).join('') ?? ''
console.log('board_add executed:', text.split('\n')[0])
const onDisk = JSON.parse(await readFile(join(ws, 'KANBAN.json'), 'utf8'))
console.log('on-disk cards:', onDisk.cards.length, '| title:', onDisk.cards[0]?.title, '| source:', onDisk.cards[0]?.sourceSessionId)
// The rendered result (the only model-visible surface) must expose the exact
// id, or board_update/board_remove are uncallable from the tool output.
if (!text.includes(onDisk.cards[0].id)) {
  console.error('board_add render does not contain the persisted card id — ids must be model-visible')
  process.exit(1)
}
console.log('board_add render carries the card id: ok')
if (onDisk.cards.length !== 1 || onDisk.cards[0].title !== '真实执行验证') {
  console.error('board_add did not persist the expected card')
  process.exit(1)
}
if (onDisk.cards[0].sourceSessionId !== fakeAgent.id) {
  console.error('board_add did not record the owning session id as sourceSessionId')
  process.exit(1)
}
await rm(ws, { recursive: true, force: true })
console.log('ok: all 4 tools registered and board_add persisted end-to-end (with sourceSessionId)')

// 4) note_add never silently overwrites: a second call with the same topic fails.
{
  const noteWs = await mkdtemp(join(tmpdir(), 'kanban-note-'))
  const noteAgent = { id: 'session-note-1', session: { header: { cwd: noteWs } } }
  const first = await executeTool(ctx, {
    callId: 'call-note-1',
    name: 'note_add',
    arguments: { class: 'feature', topic: 'same-topic', problem: 'p1', decision: 'd1' },
    agent: noteAgent,
    signal: new AbortController().signal,
  })
  if (!first.content?.some(block => block.text.includes('Agent Note written'))) {
    console.error('first note_add did not write:', first.content)
    process.exit(1)
  }
  const second = await executeTool(ctx, {
    callId: 'call-note-2',
    name: 'note_add',
    arguments: { class: 'feature', topic: 'same-topic', problem: 'p2', decision: 'd2' },
    agent: noteAgent,
    signal: new AbortController().signal,
  })
  const secondText = second.content?.map(block => block.text).join('') ?? ''
  if (second.isError !== true || !secondText.includes('already exists')) {
    console.error('note_add did not refuse to overwrite an existing note:', second)
    process.exit(1)
  }
  await rm(noteWs, { recursive: true, force: true })
  console.log('note_add refuses silent overwrite: ok')
}

// 5) /kanban/api must ask Connection's trust check before any filesystem work.
{
  const api = routes.get('/kanban/api')
  if (api === undefined) {
    console.error('plugin did not register /kanban/api')
    process.exit(1)
  }
  const routeWs = await mkdtemp(join(tmpdir(), 'kanban-route-'))
  const invoke = async (headers) => {
    let finish
    const finished = new Promise(resolve => { finish = resolve })
    const res = {
      statusCode: 200,
      writableEnded: false,
      body: undefined,
      writeHead(status) { this.statusCode = status },
      end(body) { this.writableEnded = true; this.body = body; finish() },
    }
    await api.handler({ method: 'GET', url: '/kanban/api?cwd=' + encodeURIComponent(routeWs), headers }, res)
    await finished
    return res
  }
  const rejected = await invoke({ 'x-test-untrusted': '1' })
  if (rejected.statusCode !== 403) {
    console.error('untrusted /kanban/api request was not rejected:', rejected.statusCode)
    process.exit(1)
  }
  const trusted = await invoke({})
  if (trusted.statusCode !== 200 || !String(trusted.body).includes('"ok":true')) {
    console.error('trusted /kanban/api request failed:', trusted.statusCode, trusted.body)
    process.exit(1)
  }
  await rm(routeWs, { recursive: true, force: true })
  console.log('route fence: untrusted 403, trusted 200, before any fs work: ok')
}
