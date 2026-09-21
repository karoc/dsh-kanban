/**
 * kanban-use skill delivery through the shell's own skill registry (host half).
 *
 * WHY this exists next to src/skill-sync.ts (which copies the skill into
 * ~/.agents/skills): the copy is a per-machine artifact that the package cannot
 * see. It goes stale, it can be edited into a shape DSH silently drops (0.2.7:
 * an unquoted `description` made the whole file invisible to the model), and it
 * needs a version fingerprint to tell "old package content" from "user edit".
 * DSH's `ctx.skills` registry removes all three problems: `ctx.skills.register()`
 * serves the skill straight out of the installed package, so the skill version
 * IS the plugin version.
 *
 * Precedence (packages/skill/skill: "project entries outrank runtime entries,
 * which outrank user entries"): a runtime registration beats anything in
 * ~/.agents/skills, so a stale copy left behind by an older plugin version
 * cannot shadow the shipped skill — while a project-level copy
 * (<workspace>/.agents/skills or <workspace>/.dsh/skills) still wins, which is
 * the documented way to customize it.
 *
 * Fallback: when the service is absent (an older shell, or a profile without
 * the skill packages) `registerSkillRuntime` returns false and the caller keeps
 * the copy-based self-heal. The service is reached through `ctx.get('skills')`
 * rather than `inject`, so a shell without it degrades to the fallback instead
 * of failing the plugin load.
 *
 * The frontmatter reader below is deliberately a MINIMAL parser for this file's
 * own shape (name / description / skill-version as single-line scalars), not a
 * YAML implementation: it refuses anything it does not understand, and the
 * refusal path is the copy fallback (which DSH's real YAML parser then handles).
 * scripts/verify-skill-runtime.mjs pins the shipped SKILL.md against this
 * parser, so a frontmatter edit that breaks it fails the suite instead of
 * silently degrading.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fields a runtime skill registration needs, parsed from SKILL.md. */
export interface ParsedSkillFile {
  /** Kebab-case skill name (`name:` frontmatter). */
  name: string
  /** Routing description shown in the model's skill catalog (`description:` frontmatter). */
  description: string
  /** Instruction body: everything after the frontmatter block. */
  content: string
}

/** The service shape this module needs from `ctx.skills` (structural). */
interface SkillRegistryLike {
  /**
   * `source` is required by the registry's own definition validator (a
   * registration without it throws on the first `get()`), and `'runtime'` is
   * the label the shell reserves for exactly this delivery path.
   */
  register: (skill: { name: string; description: string; content: string; source: string }) => () => void
}

/** Minimal context shape (avoids a runtime dependency on the shell's types). */
export interface ContextLike {
  get?: (name: string) => unknown
  logger?: { warn?: (message: string) => void }
  effect?: (callback: () => (() => void) | void, label?: string) => void
}

/** Strip one layer of YAML quoting from a scalar and unescape `\"` / `\\`. */
function scalarValue(raw: string): string | undefined {
  const value = raw.trim()
  if (value === '') return undefined
  const quoted = /^"(.*)"$/s.exec(value)
  if (quoted !== null) return quoted[1]?.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
  const single = /^'(.*)'$/s.exec(value)
  if (single !== null) return single[1]?.replaceAll("''", "'")
  // Plain scalar: a comment marker or any structural YAML syntax means this is
  // not the flat `key: value` shape this parser supports.
  if (/[#{}[\],&*?|>@`]/.test(value) || value.includes(': ')) return undefined
  return value
}

/**
 * Parse the packaged SKILL.md into runtime-registration fields.
 * @param text - the raw SKILL.md contents.
 * @returns the parsed fields, or undefined when the file is not the flat
 *   frontmatter shape this parser accepts (caller falls back to the copy path).
 */
export function parseSkillMarkdown(text: string): ParsedSkillFile | undefined {
  const opening = /^---\r?\n/.exec(text)
  if (opening === null) return undefined
  const closing = /\r?\n---\r?\n/.exec(text.slice(opening[0].length))
  if (closing === null) return undefined
  const headerEnd = opening[0].length + closing.index
  const header = text.slice(opening[0].length, headerEnd)
  const content = text.slice(headerEnd + closing[0].length).trim()
  let name: string | undefined
  let description: string | undefined
  for (const line of header.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const entry = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line)
    // A nested/indented or continuation line: not the flat shape we support.
    if (entry === null) return undefined
    const key = entry[1]
    const value = scalarValue(entry[2] ?? '')
    if (value === undefined) return undefined
    if (key === 'name') name = value
    else if (key === 'description') description = value
    // Any other flat key (e.g. skill-version) is metadata this path ignores.
  }
  if (name === undefined || description === undefined) return undefined
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return undefined
  if (content === '') return undefined
  return { name, description, content }
}

/**
 * Register the packaged kanban-use skill with the shell's skill registry.
 * Never throws and never blocks plugin load: a missing service, a missing file,
 * or an unparseable frontmatter all return false so the caller can fall back.
 * @param ctx - the host plugin context.
 * @param sourceFile - the packaged SKILL.md path (injectable for tests).
 * @returns true when the skill was registered at runtime.
 */
export function registerSkillRuntime(ctx: ContextLike, sourceFile?: string): boolean {
  const skills = ctx.get?.('skills') as SkillRegistryLike | undefined
  if (skills === undefined || typeof skills.register !== 'function') return false
  let text: string
  try {
    // Read synchronously: this runs inside apply(), where the shell expects
    // synchronous registration, and the file is small and local.
    text = readFileSync(sourceFile ?? defaultSkillFile(), 'utf8')
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-kanban] packaged skill could not be read (${(error as Error).message}) — falling back to the copy installer`)
    return false
  }
  const parsed = parseSkillMarkdown(text)
  if (parsed === undefined) {
    ctx.logger?.warn?.('[dsh-kanban] skills/kanban-use/SKILL.md frontmatter is not the flat name/description shape — serving it through the filesystem fallback instead')
    return false
  }
  try {
    const disposer = skills.register({
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      source: 'runtime',
    })
    ctx.effect?.(() => disposer, 'dsh-kanban: kanban-use skill registration')
    return true
  } catch (error) {
    ctx.logger?.warn?.(`[dsh-kanban] runtime skill registration failed (${(error as Error).message}) — falling back to the copy installer`)
    return false
  }
}

/** Absolute path of the packaged SKILL.md, resolved relative to the bundle. */
function defaultSkillFile(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'kanban-use', 'SKILL.md')
}
