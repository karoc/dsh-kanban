// Skill-delivery verification (host half, runs against the BUILT bundle).
//
// Proves three things a unit test on src/ cannot:
//   1. `lib/index.js` still CONTAINS the runtime skill registration — the
//      fallback call inside apply() is exactly the shape rolldown dropped once
//      before (see src/skill-sync.ts), so the check runs against the artifact
//      the shell actually loads;
//   2. with a real @deepseek-ai/dsh-skill registry mounted, plugin load
//      registers `kanban-use` and it OUTRANKS a same-named user-level provider
//      candidate (the stale ~/.agents copy case);
//   3. the shipped skills/kanban-use/SKILL.md parses with the plugin's minimal
//      frontmatter reader, and the parsed description/content match the file —
//      an edit that breaks the parser fails here instead of silently degrading
//      to the copy fallback.
//
// Run: node scripts/verify-skill-runtime.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

// --- 1) The built bundle keeps the registration code ------------------------
const bundle = readFileSync(resolve(root, 'lib', 'index.js'), 'utf8')
check('lib/index.js carries the runtime skill registration', bundle.includes('skills/kanban-use/SKILL.md'))
check('lib/index.js carries the copy-fallback installer', bundle.includes('.agents'))

const { Context, Service } = await import('@deepseek-ai/cordis')
const { default: SkillRegistry } = await import('@deepseek-ai/dsh-skill')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
const kanban = await import('../lib/index.js')

// --- 3) The shipped SKILL.md parses with the plugin's own reader ------------
const skillText = readFileSync(resolve(root, 'skills', 'kanban-use', 'SKILL.md'), 'utf8')
const parsed = kanban.parseSkillMarkdown(skillText)
check('parseSkillMarkdown accepts the shipped SKILL.md', parsed !== undefined)
if (parsed !== undefined) {
  check('parsed name is kanban-use', parsed.name === 'kanban-use', parsed.name)
  check('parsed description is the frontmatter description', parsed.description.startsWith('Use when creating, updating, or closing kanban board cards'))
  check('parsed description kept the escaped inner quotes', parsed.description.includes('"思磨力看板"') || parsed.description.includes('what/why/rejected'))
  check('parsed content is the body without frontmatter', parsed.content.startsWith('# kanban'))
  check('parsed content carries no leftover frontmatter', !parsed.content.includes('skill-version:'))
}
// Negative control: the parser must reject shapes it cannot represent.
check('parseSkillMarkdown rejects a nested description', kanban.parseSkillMarkdown('---\nname: x\ndescription:\n  nested: value\n---\nbody\n') === undefined)
check('parseSkillMarkdown rejects a missing description', kanban.parseSkillMarkdown('---\nname: x\n---\nbody\n') === undefined)

// --- 2) A real registry: runtime registration wins over a user candidate ----
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
await ctx.plugin(SkillRegistry, {})

// A same-named candidate from a user-level source, registered BEFORE the
// plugin: the stale ~/.agents/skills/kanban-use/SKILL.md case.
const USER_DESCRIPTION = 'stale user copy that must not win'
ctx.skills.registerProvider(() => ({
  name: 'fake-user-root',
  list: () => Promise.resolve([{
    name: 'kanban-use',
    description: USER_DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'fake-user-root',
    source: 'user',
    rank: 900,
    locator: 'fake',
  }]),
  get: () => Promise.resolve({
    name: 'kanban-use',
    description: USER_DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: 'fake-user-root',
    source: 'user',
    content: 'stale body',
  }),
}))

await ctx.plugin(kanban)
await new Promise(resolveWait => setTimeout(resolveWait, 200))

const catalog = await ctx.skills.list({})
const winner = catalog.find(entry => entry.name === 'kanban-use')
check('a kanban-use skill is in the catalog', winner !== undefined, catalog.map(entry => entry.name).join(', '))
if (winner !== undefined) {
  check('the runtime registration outranks the user-level candidate', winner.description !== USER_DESCRIPTION)
  check('the catalog description is the plugin-shipped one', winner.description.startsWith('Use when creating, updating, or closing kanban board cards'))
  check('the catalog provider is the runtime registry', winner.provider === 'runtime', winner.provider)
}
const definition = await ctx.skills.get('kanban-use', {})
check('the loaded body is the shipped skill body', definition?.content.startsWith('# kanban') === true)
check('the registered skill reports the shell runtime source', definition?.source === 'runtime', definition?.source)

// The fallback branch: with no skills service the registration declines so the
// caller keeps the copy installer (verified in verify-skill-sync.mjs).
const bare = new Context()
check('registerSkillRuntime declines without a skills service', kanban.registerSkillRuntime(bare) === false)

if (failures.length > 0) {
  console.error(`\n✘ skill-runtime verification failed: ${failures.join('; ')}`)
  process.exit(1)
}
console.log('SKILL_RUNTIME_OK')
