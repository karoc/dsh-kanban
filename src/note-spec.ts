/**
 * Agent Note specification: the DSH repository's Agent Note discipline,
 * replicated as editable defaults so users can paste in newer upstream content
 * without waiting for a plugin release.
 *
 * Upstream source (deepseek-harness):
 *   - note classes:     scripts/agent-note-tree.ts  -> AGENT_NOTE_CLASSES
 *   - note format:      scripts/verify-agent-note-format.ts  (headers + sections)
 *   - non-trivial rule: AGENTS.md  ("Non-trivial changes MUST include an Agent Note…")
 *   - checked at commit: 47f943859bef60e4160492346772ded9b24f765a
 *   Run `pnpm check:spec` (scripts/check-note-spec.mjs) to diff these defaults
 *   against a local dsh checkout and catch upstream changes; bump
 *   NOTE_SPEC_VERSION when a default below changes.
 *
 * A workspace may override any of these via `.agents/notes/overrides.json`.
 * `specVersion` records the plugin's default spec revision; when the plugin
 * ships a newer default than the user's stored version AND the user has custom
 * overrides, the Web UI warns that an update resets overrides to the defaults.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Current default spec revision. Bump when a default below changes. */
export const NOTE_SPEC_VERSION = 1

/** The closed set of Agent Note classes (mirrors DSH's classification gate). */
export const DEFAULT_NOTE_CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing'] as const

/**
 * Default note body template. `{{title}}` and the section placeholders are
 * replaced by note_add; section placeholders left empty drop their heading.
 * Matches the DSH implemented-note shape (## Decision, ## Consequences,
 * ## Alternatives considered optional).
 */
export const DEFAULT_NOTE_FORMAT = [
  '# Agent Note: {{title}}',
  '',
  'Status: implemented',
  '',
  '## Problem',
  '',
  '{{problem}}',
  '',
  '## Decision',
  '',
  '{{decision}}',
  '{{alternatives_section}}',
  '{{consequences_section}}',
  '',
].join('\n')

/** Default "non-trivial change" definition (mirrors DSH's AGENTS.md rule). */
export const DEFAULT_NON_TRIVIAL_DEFINITION =
  'A change is NON-TRIVIAL (so it needs a note) when it changes behavior, architecture, '
  + 'cross-file or cross-package conventions, process or tooling, test strategy, on-disk '
  + 'storage format, wire/protocol format, or configuration format — or makes any decision '
  + 'a maintainer could reasonably revisit later. Mechanical or local-only edits (renames, '
  + 'formatting, pure comments, no behavior change) are exempt.'

/** A per-workspace override of one or more spec defaults. */
export interface NoteSpecOverrides {
  /** The plugin default spec revision the user last saw/acknowledged. */
  readonly specVersion?: number
  /** Override for the note class list, or undefined to use the default. */
  readonly noteClasses?: readonly string[]
  /** Override for the body template, or undefined to use the default. */
  readonly noteFormat?: string
  /** Override for the non-trivial definition, or undefined to use the default. */
  readonly nonTrivialDefinition?: string
}

/** The effective spec for a workspace: defaults with any overrides applied. */
export interface EffectiveNoteSpec {
  readonly specVersion: number
  readonly noteClasses: readonly string[]
  readonly noteFormat: string
  readonly nonTrivialDefinition: string
  /** True when at least one field was overridden by the user. */
  readonly hasOverrides: boolean
}

/** Resolve the overrides file path for one workspace. */
export function noteOverridesPath(cwd: string): string {
  if (!isAbsolute(cwd)) throw new TypeError(`kanban: workspace must be an absolute path, got ${JSON.stringify(cwd)}`)
  return join(cwd, '.agents', 'notes', 'overrides.json')
}

/** Read a workspace's overrides (missing file => empty). */
export async function readNoteOverrides(cwd: string): Promise<NoteSpecOverrides> {
  try {
    const raw = await readFile(noteOverridesPath(cwd), 'utf8')
    const parsed = JSON.parse(raw) as Partial<NoteSpecOverrides>
    return {
      ...parsed.specVersion !== undefined && Number.isSafeInteger(parsed.specVersion) ? { specVersion: parsed.specVersion } : {},
      ...parsed.noteClasses !== undefined && Array.isArray(parsed.noteClasses)
        && parsed.noteClasses.every(c => typeof c === 'string') ? { noteClasses: parsed.noteClasses } : {},
      ...parsed.noteFormat !== undefined && typeof parsed.noteFormat === 'string' ? { noteFormat: parsed.noteFormat } : {},
      ...parsed.nonTrivialDefinition !== undefined && typeof parsed.nonTrivialDefinition === 'string'
        ? { nonTrivialDefinition: parsed.nonTrivialDefinition } : {},
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

/** Persist a workspace's overrides (empty overrides removes the file). */
export async function writeNoteOverrides(cwd: string, overrides: NoteSpecOverrides): Promise<void> {
  const clean: Record<string, unknown> = {}
  if (overrides.specVersion !== undefined) clean.specVersion = overrides.specVersion
  if (overrides.noteClasses !== undefined && overrides.noteClasses.length > 0) clean.noteClasses = overrides.noteClasses
  if (overrides.noteFormat !== undefined && overrides.noteFormat.trim() !== '') clean.noteFormat = overrides.noteFormat
  if (overrides.nonTrivialDefinition !== undefined && overrides.nonTrivialDefinition.trim() !== '') {
    clean.nonTrivialDefinition = overrides.nonTrivialDefinition
  }
  const path = noteOverridesPath(cwd)
  if (Object.keys(clean).length === 0) {
    // Nothing overridden — leave any existing file (readers fall back to defaults).
    return
  }
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(clean, null, 2) + '\n', 'utf8')
}

/** Compute the effective spec for a workspace. */
export async function effectiveNoteSpec(cwd: string): Promise<EffectiveNoteSpec> {
  const overrides = await readNoteOverrides(cwd)
  const noteClasses = overrides.noteClasses !== undefined ? [...overrides.noteClasses] : [...DEFAULT_NOTE_CLASSES]
  return {
    specVersion: overrides.specVersion ?? NOTE_SPEC_VERSION,
    noteClasses,
    noteFormat: overrides.noteFormat ?? DEFAULT_NOTE_FORMAT,
    nonTrivialDefinition: overrides.nonTrivialDefinition ?? DEFAULT_NON_TRIVIAL_DEFINITION,
    hasOverrides: overrides.noteClasses !== undefined || overrides.noteFormat !== undefined
      || overrides.nonTrivialDefinition !== undefined,
  }
}
