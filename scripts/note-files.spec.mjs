/**
 * Unit tests for Agent Note file naming (src/note-files.ts): readable,
 * collision-free names for non-ASCII topics and the local calendar day.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteFileName } from '../src/note-files.ts'

test('ASCII topics keep the historical kebab filename', () => {
  const date = new Date(2026, 10, 1)
  assert.equal(noteFileName('Web Kanban Plugin', date), '2026-11-01-web-kanban-plugin.md')
})

test('non-ASCII topics stay readable and carry a hash suffix', () => {
  const name = noteFileName('看板锁修复', new Date(2026, 10, 1))
  assert.match(name, /^2026-11-01-看板锁修复-[0-9a-f]{8}\.md$/)
})

test('two non-ASCII topics that differ only in punctuation never collide', () => {
  const a = noteFileName('看板 锁', new Date(2026, 10, 1))
  const b = noteFileName('看板-锁', new Date(2026, 10, 1))
  assert.notEqual(a, b)
})

test('an all-punctuation topic still gets a hash-based name', () => {
  const name = noteFileName('***', new Date(2026, 10, 1))
  assert.match(name, /^2026-11-01-note-[0-9a-f]{8}\.md$/)
})
