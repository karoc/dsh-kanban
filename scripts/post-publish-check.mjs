#!/usr/bin/env node
/**
 * Post-publish verification, run by npm's `postpublish` lifecycle AFTER the
 * package has been uploaded.
 *
 * It CANNOT prevent a bad publish — the upload already happened. Its job is to
 * confirm the release actually landed on the registry and to raise a loud,
 * unambiguous alarm when it did not, so a silent/partial publish is never
 * mistaken for success.
 *
 * Registry eventual consistency: right after upload, the version document can
 * still 404 while the index catches up — MEASURED at several minutes, not
 * seconds (@karoc/dsh-proxy 0.1.1 took ~4 minutes; on 2026-09-19 a 60s window
 * reported a successful sibling-plugin publish as a failure while npm had
 * already returned PUT 200), so this script POLLS for up to ~5 minutes before
 * judging it.
 *
 * Timeout semantics: postpublish runs ONLY after the upload succeeded, so a
 * version that stays invisible is almost always index lag, not a failed
 * publish. The script therefore distinguishes:
 *   - package document visible (any version) → the package IS on the registry;
 *     the new version is just not indexed yet → treat as published (exit 0)
 *     with a clear "verify manually, do not re-publish" note;
 *   - package document also 404 → genuinely unconfirmed → exit 1.
 *
 * All registry reads go through `fetch` directly (no `npm view` subprocess):
 * npm CLI prints a full multi-line E404 error block for every probe of a
 * not-yet-visible version, which drowned the publish output in 404s even when
 * everything was working. Polling here prints a short progress line instead.
 *
 * Checks (after the version becomes visible):
 *   1. `dist-tags.latest` on the registry equals package.json version
 *   2. the published tarball contains every expected file
 *
 * The `latest` dist-tag is the other eventual-consistency surface: npm writes
 * the version document first and flips the tag moments later, so a single
 * snapshot right after upload can read the previous tag (real 0.2.4 incident:
 * "latest is 0.2.3, expected 0.2.4" while the publish was fine). Like version
 * visibility, the tag is POLLED until it catches up (or a timeout elapses).
 *
 * Like every lifecycle script, it is skipped by `npm publish --ignore-scripts`
 * (documented in CONTRIBUTING.md).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = pkg
const problems = []

console.log(`post-publish-check: ${name}@${version}`)

/** Fetch a registry JSON document; null when the resource 404s (not visible). */
async function fetchRegistryJson(path) {
  const response = await fetch(`https://registry.npmjs.org/${path}`, { signal: AbortSignal.timeout(10000) })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`registry returned HTTP ${response.status} for ${path}`)
  return await response.json()
}

/** True once the version document stops 404-ing (index caught up). */
async function versionVisible() {
  const doc = await fetchRegistryJson(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`)
  return doc !== null && typeof doc.version === 'string'
}

/** Fetch the package-level document (any version visible?) — the stronger signal. */
async function packageVisible() {
  const doc = await fetchRegistryJson(encodeURIComponent(name))
  return doc !== null && typeof doc === 'object'
}

// Poll until the published version is visible in the registry index.
// npm's own message says indexing "may take a few minutes", so allow 5 min.
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 100 // up to ~5 minutes of waiting
let visible = false
try { visible = await versionVisible() } catch { /* probe failure — keep polling */ }
for (let attempt = 1; !visible && attempt <= POLL_ATTEMPTS; attempt += 1) {
  if (attempt % 10 === 1 || attempt === POLL_ATTEMPTS) {
    console.log(`   (version not visible yet — registry index catching up; retry ${attempt}/${POLL_ATTEMPTS})`)
  }
  await sleep(POLL_INTERVAL_MS)
  try { visible = await versionVisible() } catch { /* probe failure — keep polling */ }
}
if (!visible) {
  // Distinguish "index lag on a live package" from "package not found at all".
  let packageLive = false
  try { packageLive = await packageVisible() } catch { /* probe failure */ }
  if (packageLive) {
    // The package document exists — the upload landed; only the version index
    // is still catching up. Treat as published; npm itself warned processing
    // "may take a few minutes", and postpublish only runs after the upload.
    console.error(`\n⚠️  version ${version} is not indexed yet after 5 minutes of polling,`)
    console.error('   but the package document IS live on the registry — the upload succeeded.')
    console.error('   The index is still catching up (npm: "may take a few minutes").')
    console.error(`   Verify shortly with: npm view ${name} versions`)
    console.error(`   Do NOT re-publish ${version} — it is live or about to be.`)
    process.exit(0)
  }
  console.error(`\n⚠️  ${name}@${version} did not become visible on the registry after `
    + `${Math.round((POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000)}s of polling,`)
  console.error('   and the package document is not visible either.')
  console.error('   The publish may have failed before the upload completed, or the index')
  console.error(`   is still extremely slow. Verify manually with: npm view ${name} versions`)
  console.error(`   Do NOT re-publish ${version} without checking — it may be live.`)
  process.exit(1)
}
console.log(`✅ version ${version} is visible on the registry`)

// 1. dist-tags.latest must match the published version. This is also an
//    eventual-consistency surface — npm writes the version document first and
//    flips `latest` moments later — so poll (same cadence as visibility) and
//    only report when the tag still has not caught up.
let latest = undefined
let distTags = {}
let lastDistTagError = undefined
for (let attempt = 0; attempt <= POLL_ATTEMPTS; attempt += 1) {
  if (attempt > 0) {
    console.log(`   (dist-tag "latest" not yet ${version} — registry tag update catching up; retry ${attempt}/${POLL_ATTEMPTS})`)
    await sleep(POLL_INTERVAL_MS)
  }
  try {
    const pkgDoc = await fetchRegistryJson(encodeURIComponent(name))
    distTags = pkgDoc?.['dist-tags'] ?? {}
    latest = typeof distTags.latest === 'string' ? distTags.latest : undefined
  } catch (error) {
    // Probe failure — keep polling rather than failing on a transient blip.
    lastDistTagError = error
  }
  if (latest === version) break
}
if (latest === undefined) {
  problems.push(lastDistTagError
    ? `could not read dist-tags: ${lastDistTagError.message}`
    : `dist-tags has no "latest" (got: ${JSON.stringify(distTags)})`)
} else if (latest !== version) {
  problems.push(`registry "latest" is ${latest}, expected ${version} — if this publish used an explicit --tag, the mismatch is expected; otherwise check the dist-tag`)
}
if (latest === version) console.log('✅ dist-tags.latest matches the published version')

// 2. The published tarball contains every expected file.
const EXPECTED = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'package.json']
try {
  const versionDoc = await fetchRegistryJson(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`)
  const tarball = versionDoc?.dist?.tarball
  if (typeof tarball !== 'string' || tarball === '') throw new Error('registry returned no tarball URL')
  const listing = execSync(`curl -s --max-time 20 ${JSON.stringify(tarball)} | tar -tzf -`, {
    cwd: root, encoding: 'utf8', timeout: 25000,
  })
  for (const file of EXPECTED) {
    if (!listing.includes(`package/${file}`)) problems.push(`published tarball is missing package/${file}`)
  }
  const allPresent = EXPECTED.every((file) => listing.includes(`package/${file}`))
  if (allPresent) console.log('✅ published tarball contains all expected files')
} catch (error) {
  problems.push(`could not inspect published tarball: ${error.message}`)
}

if (problems.length > 0) {
  console.error('\n⚠️  post-publish-check found problems:')
  for (const p of problems) console.error(`   - ${p}`)
  console.error(`\n   IMPORTANT: ${name}@${version} IS live on the registry — the publish itself`)
  console.error('   completed. These are POST-publish findings; do NOT re-publish the same version.')
  console.error('   Fix the cause and address it in the next release.')
  process.exit(1)
}

console.log('\n✅ post-publish-check passed: release is live and consistent on npm.')
