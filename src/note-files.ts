/**
 * Agent Note file naming (dependency-free so the unit gates can run in CI).
 *
 * A topic with no ASCII letters/digits (Chinese, emoji, punctuation only) used
 * to collapse onto `note.md`, so two different decisions silently shared one
 * file. Non-ASCII topics now keep their readable letters and a short hash
 * suffix (two topics differing only in punctuation must not collide), and the
 * date is the local calendar day the note was written.
 */
import { createHash } from 'node:crypto'

/** Local calendar day as `YYYY-MM-DD` (note dates follow the author's day). */
function localDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Canonical note file name: `<yyyy-mm-dd>-<kebab-topic>[-<hash>].md`.
 * ASCII topics keep their historical kebab name (no hash); a topic with any
 * non-ASCII letter/number keeps those characters for readability and appends
 * an 8-char hash of the raw topic so different topics cannot share a file.
 * @param topic - the note topic from `note_add`.
 * @param date - the day the note is written (defaults to now).
 * @returns the file name, including the `.md` extension.
 */
export function noteFileName(topic: string, date = new Date()): string {
  const trimmed = topic.trim()
  const slug = trimmed.toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const hadSlug = slug !== ''
  const base = hadSlug ? slug : 'note'
  // An empty slug means the raw topic carried no usable characters — the hash
  // is the only thing that keeps two such topics apart.
  const asciiOnly = hadSlug && /^[a-z0-9-]+$/.test(base)
  const hash = createHash('sha256').update(trimmed).digest('hex').slice(0, 8)
  return `${localDate(date)}-${base}${asciiOnly ? '' : `-${hash}`}.md`
}
