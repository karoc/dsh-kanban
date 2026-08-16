// Manual smoke check for the host half: boot systemPrompt + ToolRuntime +
// FakeWebServer + kanban on a bare cordis context, then list the board_* tools.
// Run: node scripts/verify-tools.mjs
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
const schemas = ctx.tools.schemas()
const board = schemas.map(s => s.name).filter(n => n.startsWith('board_'))
console.log('board tools:', board.join(', '))
if (board.length !== 4) {
  console.error('expected 4 board tools')
  process.exit(1)
}
