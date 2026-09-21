/**
 * Unit tests for the recent-workspace and current-session derivations
 * (workspace-pick.ts): DSH removed `recentWorkspaceId` from the
 * WorkspaceSnapshot, so the client derives the most-recently-active workspace
 * from the workspaces + sessions feeds — mirroring ui-workspace's
 * `recentWorkspace` (navigation.ts). DSH 0.1.6-alpha.2 then removed the session
 * list's `current` field, so the current Session is derived from main-view
 * retention (`retainedBy.mainView > 0`) with `current` still honored for
 * 0.1.2–0.1.5. Runs with node:test against the TS source (Node type-stripping).
 * Run: node --test scripts/workspace-pick.spec.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { currentSessionId, recentWorkspaceId } from '../src/client/workspace-pick.ts'

const WS_A_S1 = { workspaceId: 'a', sessionIds: ['s1'], createdAt: '2026-01-01T00:00:00.000Z' }
const WS_B_S2 = { workspaceId: 'b', sessionIds: ['s2'], createdAt: '2026-01-02T00:00:00.000Z' }

test('picks the workspace whose attached session is most recently updated', () => {
  const byId = { s1: { updatedAt: 1000 }, s2: { updatedAt: 2000 } }
  assert.equal(recentWorkspaceId([WS_A_S1, WS_B_S2], byId), 'b')
})

test('a workspace with no session falls back to its createdAt', () => {
  const items = [
    WS_A_S1,
    { workspaceId: 'b', createdAt: '2026-02-01T00:00:00.000Z' },
    { workspaceId: 'c', createdAt: '2026-01-15T00:00:00.000Z' },
  ]
  const byId = { s1: { updatedAt: 1000 } }
  assert.equal(recentWorkspaceId(items, byId), 'b')
})

test('a session updatedAt outranks another workspace createdAt', () => {
  const items = [
    WS_A_S1, // session s1 updatedAt 100
    { workspaceId: 'b', createdAt: '2026-02-01T00:00:00.000Z' }, // Jan5 epoch? no: epoch day 32
  ]
  // Session timestamp (ms epoch 100) is way older than the ISO createdAt —
  // but with a session attached, createdAt does NOT enter; only b has no
  // session, so b uses createdAt and wins on time. To prove "session wins",
  // give a: s1 updatedAt huge; b created recently without sessions.
  const byIdA = { s1: { updatedAt: 1_800_000_000_000 } }
  assert.equal(recentWorkspaceId(items, byIdA), 'a')
})

test('ignores sessions without updatedAt and invalid createdAt dates', () => {
  const items = [
    { workspaceId: 'a', sessionIds: ['s1'], createdAt: 'not-a-date' },
    { workspaceId: 'b', sessionIds: ['s2'] },
  ]
  const byId = { s2: { updatedAt: 42 } }
  assert.equal(recentWorkspaceId(items, byId), 'b')
  // No usable signal anywhere: the derivation still settles on the first
  // item (official ui-workspace behavior — `selected === undefined` picks the
  // first workspace), so callers' `?? items[0]` fallback keeps working.
  assert.equal(recentWorkspaceId(items, {}), 'a')
  assert.equal(recentWorkspaceId(items, undefined), 'a')
})

test('empty items return undefined', () => {
  assert.equal(recentWorkspaceId([], {}), undefined)
  assert.equal(recentWorkspaceId([], undefined), undefined)
})

test('ties go to the first workspace (stable order)', () => {
  const byId = { s1: { updatedAt: 5 }, s2: { updatedAt: 5 } }
  assert.equal(recentWorkspaceId([WS_A_S1, WS_B_S2], byId), 'a')
})

test('missing byId falls back to createdAt everywhere', () => {
  const items = [
    { workspaceId: 'a', createdAt: '2026-01-02T00:00:00.000Z' },
    { workspaceId: 'b', createdAt: '2026-01-01T00:00:00.000Z' },
  ]
  assert.equal(recentWorkspaceId(items, undefined), 'a')
})

test('workspaces whose sessions are missing from byId fall to createdAt', () => {
  // s1/s2 are not in byId, so both fall back to createdAt; b is newer.
  const items = [
    { workspaceId: 'a', sessionIds: ['s1'], createdAt: '2026-01-01T00:00:00.000Z' },
    { workspaceId: 'b', sessionIds: ['s2'], createdAt: '2026-01-02T00:00:00.000Z' },
  ]
  assert.equal(recentWorkspaceId(items, { other: { updatedAt: 1 } }), 'b')
})

// --- currentSessionId: both DSH selection eras -----------------------------

test('currentSessionId reads the 0.1.6+ main-view retention signal', () => {
  const sessions = {
    byId: {
      s1: { cwd: '/w/a', retainedBy: { pane: 1 } },
      s2: { cwd: '/w/b', retainedBy: { mainView: 1 } },
    },
  }
  assert.equal(currentSessionId(sessions), 's2')
})

test('currentSessionId falls back to the pre-0.1.6 `current` field', () => {
  const sessions = {
    current: 's1',
    byId: {
      s1: { cwd: '/w/a', retainedBy: { mainView: 1 } },
      s2: { cwd: '/w/b', retainedBy: { mainView: 1 } },
    },
  }
  assert.equal(currentSessionId(sessions), 's1')
})

test('currentSessionId is undefined with no staged session (global panel open)', () => {
  // 0.1.6-alpha.2 zeroes main-view retention while a global panel is selected;
  // a retained non-main consumer (e.g. a job) must not be mistaken for it.
  assert.equal(currentSessionId({ byId: { s1: { retainedBy: { jobs: 2 } } } }), undefined)
  assert.equal(currentSessionId({ byId: { s1: {} } }), undefined)
  assert.equal(currentSessionId({ byId: {} }), undefined)
  assert.equal(currentSessionId(undefined), undefined)
  assert.equal(currentSessionId({}), undefined)
})

test('currentSessionId ignores an empty legacy `current` string', () => {
  const sessions = { current: '', byId: { s2: { retainedBy: { mainView: 3 } } } }
  assert.equal(currentSessionId(sessions), 's2')
})

test('currentSessionId reads a zero retention count as not staged', () => {
  const sessions = { byId: { s1: { retainedBy: { mainView: 0 } }, s2: { retainedBy: { mainView: 1 } } } }
  assert.equal(currentSessionId(sessions), 's2')
})