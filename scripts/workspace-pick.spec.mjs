/**
 * Unit tests for the recent-workspace derivation (workspace-pick.ts): DSH
 * removed `recentWorkspaceId` from the WorkspaceSnapshot, so the client
 * derives the most-recently-active workspace from the workspaces + sessions
 * feeds — mirroring ui-workspace's `recentWorkspace` (navigation.ts). Runs
 * with node:test against the TS source (Node type-stripping).
 * Run: node --test scripts/workspace-pick.spec.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recentWorkspaceId } from '../src/client/workspace-pick.ts'

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