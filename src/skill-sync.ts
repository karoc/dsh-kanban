/**
 * kanban-use skill self-heal installation (host half).
 *
 * The skill ships inside the npm package (files: skills/kanban-use/SKILL.md),
 * so `dsh plugin add/update dsh-kanban` puts the file on disk automatically.
 * But the AGENT skills directory (~/.agents/skills) is a per-machine local
 * asset that npm does NOT touch — so every dsh web start, this module makes
 * sure the skill is present there, mirroring the plugin's copy:
 *
 *   - target missing                      → copy the shipped SKILL.md in
 *   - target identical to the package copy → no-op (fast path, every start)
 *   - target differs                      → KEEP the local file (the user may
 *     have edited it deliberately — same no-clobber policy as
 *     scripts/install-skill.mjs) and print one startup hint
 *
 * Copy-based (NOT symlink): pnpm lays out node_modules/.pnpm/<pkg>@<version>
 * per version, so a symlink into the package would break on the next update;
 * content copy + identity check self-heals across updates via the restart
 * that plugin installs require anyway. The check runs at plugin load only
 * (once per dsh web start), never per request.
 *
 * The manual dev command remains `pnpm install:skill` (repo checkout) or
 * `node scripts/install-skill.mjs --copy` (anywhere, incl. inside the
 * installed package — the script is shipped too).
 *
 * ⚠️ Tree-shaking: this module is KEPT in the bundle because the self-heal
 * runs as a module top-level side effect below, and src/index.ts imports it
 * as a side-effect import ('./skill-sync.ts'). A plain "call inside apply()"
 * was rolled out entirely by rolldown (same trap as §5 styles); do not move
 * the self-heal call into a function that only apply() references.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the shipped skill file inside this package (lib/../skills). */
export function skillSourceFile(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'kanban-use', 'SKILL.md')
}

/** Absolute path of the installed skill file under the local agent skills dir. */
export function skillTargetFile(home = homedir()): string {
  return join(home, '.agents', 'skills', 'kanban-use', 'SKILL.md')
}

/**
 * Ensure the kanban-use skill is installed under the agent skills directory.
 * Never throws: the plugin must keep loading even if the user home is
 * read-only — failures warn and fall through to the manual installer.
 */
export async function ensureSkillInstalled(home = homedir()): Promise<void> {
  const source = skillSourceFile()
  let sourceText: string
  try {
    sourceText = await readFile(source, 'utf8')
  } catch (error) {
    console.warn(`[dsh-kanban] shipped skill not found at ${source} (${(error as Error).message}) — skill auto-install skipped`)
    return
  }
  const target = skillTargetFile(home)
  let targetText: string | undefined
  try {
    targetText = await readFile(target, 'utf8')
  } catch {
    // Missing — install below.
  }
  if (targetText === sourceText) return
  if (targetText !== undefined) {
    console.warn(
      '[dsh-kanban] ~/.agents/skills/kanban-use/SKILL.md differs from the plugin version — '
      + 'your local copy is kept (it may be your own edit). To sync to the shipped version, '
      + 'delete it or run: node '
      + JSON.stringify(join(dirname(skillSourceFile()), '..', 'scripts', 'install-skill.mjs'))
      + ' --copy',
    )
    return
  }
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, sourceText, 'utf8')
    console.log('[dsh-kanban] kanban-use skill installed to ' + target)
  } catch (error) {
    console.warn(`[dsh-kanban] could not auto-install the kanban-use skill (${(error as Error).message}) — run install-skill.mjs manually`)
  }
}

// Module top-level side effect: self-heal on every bundle load (= every dsh
// web start). Keeps this module alive against rolldown tree-shaking AND runs
// the install without waiting for apply(); fire-and-forget, never throws.
void ensureSkillInstalled()