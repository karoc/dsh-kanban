/**
 * Verify the session-start board snapshot (systemPrompt.context): assembling
 * for an agent with a cwd injects the workspace's open items; no cwd / empty
 * board contributes nothing; and a card title containing `{{...}}` (which the
 * shell's prompt interpolator would otherwise reject, failing the snapshot for
 * every request) is rendered literally instead of breaking assembly.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Context, Service } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt, renderContextSnapshot } = await import('@deepseek-ai/dsh-system-prompt')
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

const ws = await mkdtemp(join(tmpdir(), 'kanban-ctx-'))
const now = Date.now()
// A workspace with 2 open + 1 done card.
await writeFile(join(ws, 'KANBAN.json'), JSON.stringify({
  version: 1,
  cards: [
    { id: 'c1', title: '实现方案A', status: 'in_progress', tags: ['dev'], createdAt: now, updatedAt: now },
    { id: 'c2', title: '写README', status: 'todo', tags: [], createdAt: now, updatedAt: now },
    { id: 'c3', title: '已完成的卡', status: 'done', tags: [], createdAt: now, updatedAt: now },
  ],
}, null, 2), 'utf8')

const ctx = new Context()
await ctx.plugin(SystemPrompt, {})
await ctx.plugin(ToolRuntime, {})
await ctx.plugin(FakeWebServer)
await ctx.plugin(FakeCommands)
await ctx.plugin(kanban)
await new Promise(r => setTimeout(r, 200))

// 1) With an agent whose cwd = ws → context should contain the open items.
const assembly = await ctx.systemPrompt.assemble({
  agent: { session: { header: { cwd: ws } } },
})
const contextText = assembly.contexts.map(c => c.text).join('\n')
console.log('contexts:', assembly.contexts.map(c => c.name).join(', '))
const hasSnapshot = contextText.includes('open items') && contextText.includes('实现方案A')
  && contextText.includes('缺:为什么') && !contextText.includes('已完成的卡')
console.log('injects open items (not done) with missing-field marks:', hasSnapshot)
console.log('--- snapshot text ---')
console.log(contextText.split('open items')[1] ?? '(none)')

// 2) No agent → context contributes nothing (name may still be listed, but text is empty).
const bare = await ctx.systemPrompt.assemble({})
const bareText = bare.contexts.find(c => c.name === 'board:open-items')?.text ?? ''
const noAgentClean = bareText === ''
console.log('no-agent board context text empty:', noAgentClean, JSON.stringify(bareText))

// 3) Agent with no cwd → contributes nothing.
const noCwd = await ctx.systemPrompt.assemble({ agent: { session: { header: {} } } })
const noCwdText = noCwd.contexts.find(c => c.name === 'board:open-items')?.text ?? ''
const noCwdClean = noCwdText === ''
console.log('no-cwd board context text empty:', noCwdClean, JSON.stringify(noCwdText))

// 4) A card title containing `{{...}}` must not break the rendered snapshot.
//    The shell interpolates every context; an unresolvable `{{name}}` throws and
//    would fail the runtime-context snapshot for EVERY request while that card
//    is open. Negative control: this case failed before literalPromptText()
//    existed (see the CHANGELOG entry for 0.2.8).
await writeFile(join(ws, 'KANBAN.json'), JSON.stringify({
  version: 1,
  cards: [
    { id: 'c1', title: '修复 {{TOKEN}} 渲染', status: 'todo', tags: [], createdAt: now, updatedAt: now },
  ],
}, null, 2), 'utf8')
try {
  const braces = await ctx.systemPrompt.assemble({ agent: { session: { header: { cwd: ws } } } })
  const rendered = renderContextSnapshot(braces)
  const literalTitle = rendered.includes('修复') && rendered.includes('TOKEN') && rendered.includes('渲染')
  const noRawBraces = !rendered.includes('{{')
  console.log('braces in a card title render without throwing:', literalTitle && noRawBraces)
  if (!literalTitle || !noRawBraces) {
    console.error('✘ a `{{...}}` card title either broke rendering or kept the raw sequence')
    process.exit(1)
  }
} catch (error) {
  console.error(`✘ rendering threw on a \`{{...}}\` card title: ${error.message}`)
  process.exit(1)
}

await rm(ws, { recursive: true, force: true })
console.log(hasSnapshot && noAgentClean && noCwdClean ? 'CONTEXT_OK' : 'CONTEXT_FAIL')
