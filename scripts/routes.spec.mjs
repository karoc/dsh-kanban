/**
 * Route-level tests for the host half's /kanban/* data channel — specifically
 * the trust fence, which had to survive an upstream removal.
 *
 * DSH ≤ 0.1.x exposed `Connection.requestRejection` and routes registered on
 * `webServer` bypassed the page authentication, so the plugin called it first.
 * DSH 0.2.x REMOVED that method: `webServer` now defaults every route to
 * `auth: 'required'` (an unauthenticated request is answered 401 before a
 * handler runs) and passes the admitted Peer as the handler's third argument.
 * The unguarded call threw, and the server's last-resort guard answered **400
 * with an empty body** — in a real browser that was "Unexpected end of JSON
 * input" on every board read, i.e. an empty board page on dsh 0.2.2-rc.3.
 *
 * These tests run against the BUILT bundle (`npm run bundle`) because that is
 * what the host loads. Run: node --test scripts/routes.spec.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { Context, Service } = await import('@deepseek-ai/cordis')
const { default: SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
const kanban = await import('../lib/index.js')

/** A Response stand-in with the surface the route handlers use. */
function fakeResponse() {
  let finish
  const ended = new Promise(resolve => { finish = resolve })
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers ?? {})
      return this
    },
    setHeader(key, value) { this.headers[key.toLowerCase()] = value },
    end(chunk) {
      if (chunk !== undefined) this.body += String(chunk)
      this.writableEnded = true
      finish(this)
    },
    once() {},
    on() {},
    off() {},
  }
  return { res, ended }
}

/** A GET request stand-in (the handlers only read method/url/headers). */
function fakeRequest(url, headers = {}) {
  return { method: 'GET', url, headers, on() {}, once() {}, off() {} }
}

/**
 * Boot the plugin on a bare context and capture the routes it registers.
 * @param host - `'old'` = Connection exposes requestRejection (≤0.1.x),
 *   `'new'` = the 0.2.x shape where that method is gone.
 */
async function boot(host, workspace) {
  const routes = new Map()
  class FakeWebServer extends Service {
    constructor(ctx) { super(ctx, 'webServer') }
    register(route) { routes.set(route.path, route); return () => routes.delete(route.path) }
  }
  class FakeCommands extends Service {
    constructor(ctx) { super(ctx, 'commands') }
    register() { return () => {} }
  }
  class OldConnection extends Service {
    constructor(ctx) { super(ctx, 'connection') }
    requestRejection(req) { return req.headers['x-test-untrusted'] !== undefined ? 403 : undefined }
  }
  class NewConnection extends Service {
    constructor(ctx) { super(ctx, 'connection') }
    // DSH 0.2.x: no requestRejection — the webServer owns the decision.
  }
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(FakeCommands)
  await ctx.plugin(host === 'old' ? OldConnection : NewConnection)
  await ctx.plugin(kanban)
  await new Promise(resolve => setTimeout(resolve, 200))
  return { ctx, routes }
}

const apiQuery = (workspace) => `/kanban/api?cwd=${encodeURIComponent(workspace)}`

test('kanban routes answer on a DSH 0.2.x host that removed Connection.requestRejection', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'kanban-routes-new-'))
  try {
    await writeFile(join(workspace, 'KANBAN.json'), JSON.stringify({
      version: 1,
      cards: [{
        id: 'card-live', title: 'live route card', status: 'done', tags: ['route'],
        createdAt: 1, updatedAt: 2, summary: 's', rationale: 'r', rejected: 'x',
      }],
    }), 'utf8')
    const { routes } = await boot('new', workspace)
    const route = routes.get('/kanban/api')
    assert.ok(route, '/kanban/api must be registered')
    assert.equal(route.kind, 'prefix')

    const { res, ended } = fakeResponse()
    // The peer is what the 0.2.x host admits before dispatching the handler.
    await route.handler(fakeRequest(apiQuery(workspace)), res, { sessionId: 'peer-1' })
    await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 3000))])

    assert.equal(res.statusCode, 200, `expected 200 from the route, got ${res.statusCode} (body: ${res.body})`)
    const payload = JSON.parse(res.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.cards.length, 1)
    assert.equal(payload.cards[0].id, 'card-live')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('an unauthenticated request with no Peer and no fence fails closed', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'kanban-routes-closed-'))
  try {
    await writeFile(join(workspace, 'KANBAN.json'), JSON.stringify({ version: 1, cards: [] }), 'utf8')
    const { routes } = await boot('new', workspace)
    const { res, ended } = fakeResponse()
    // No third argument: exactly what a host that failed to authenticate would pass.
    await routes.get('/kanban/api').handler(fakeRequest(apiQuery(workspace)), res)
    await Promise.race([ended, new Promise(resolve => setTimeout(resolve, 3000))])
    assert.equal(res.statusCode, 401)
    assert.equal(res.body.includes('authenticated session'), true)
    assert.equal(res.body.includes('"cards"'), false, 'an unauthenticated request must not read the board')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('a DSH 0.1.x host keeps the Connection trust fence (403 for an untrusted request)', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'kanban-routes-old-'))
  try {
    await writeFile(join(workspace, 'KANBAN.json'), JSON.stringify({ version: 1, cards: [] }), 'utf8')
    const { routes } = await boot('old', workspace)

    const untrusted = fakeResponse()
    await routes.get('/kanban/counts').handler(fakeRequest(`/kanban/counts?cwd=${encodeURIComponent(workspace)}`, { 'x-test-untrusted': '1' }), untrusted.res)
    await Promise.race([untrusted.ended, new Promise(resolve => setTimeout(resolve, 3000))])
    assert.equal(untrusted.res.statusCode, 403)
    assert.equal(untrusted.res.body.includes('"open"'), false)

    const trusted = fakeResponse()
    await routes.get('/kanban/counts').handler(fakeRequest(`/kanban/counts?cwd=${encodeURIComponent(workspace)}`), trusted.res)
    await Promise.race([trusted.ended, new Promise(resolve => setTimeout(resolve, 3000))])
    assert.equal(trusted.res.statusCode, 200)
    assert.equal(JSON.parse(trusted.res.body).ok, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
