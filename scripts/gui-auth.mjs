/**
 * Shared GUI-entry helper for the dsh-kanban Playwright verification scripts.
 *
 * Since DSH 0.1.2-alpha.2 the Web GUI gates the index page behind a
 * browser-session cookie ("dsh web authentication required; reopen the URL
 * printed by dsh web."). Automation follows the same handshake a human
 * browser does: visit `<base>/?token=<token>` once to mint the signed cookie,
 * then continue on the normal URL.
 *
 * The launch token is process-local (printed by `dsh web`), so scripts read
 * it from `DSH_WEB_TOKEN` (or the full URL including `?token=` may be given
 * via `DSH_GUI_URL`). Pre-auth instances (or instances where auth is
 * disabled) keep working untouched: the helper only acts when the index
 * actually answers 401.
 */

/** The token query parameter the connection package's browser-auth reads. */
const TOKEN_QUERY = 'token'

/**
 * Open the GUI at `base`, authenticating through the launch-token handshake
 * when the index is gated. Rejects with an actionable message when auth is
 * required but no token is available (so the script fails loud, not with a
 * confusing "element not found" on the 401 page).
 * @param page - a fresh Playwright page.
 * @param base - GUI origin, e.g. http://127.0.0.1:3080.
 * @returns the same page, positioned at the authenticated app.
 */
export async function gotoApp(page, base) {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const body = await page.textContent('body').catch(() => '')
  if (!body.includes('authentication required')) return page

  // The launch URL itself may carry `?token=` (DSH_GUI_URL) — prefer it.
  const token = process.env.DSH_WEB_TOKEN
    ?? new URL(base).searchParams.get(TOKEN_QUERY)
  if (!token) {
    throw new Error(
      'GUI requires browser auth (dsh web gate). Set DSH_WEB_TOKEN to the '
      + `token from the dsh web launch URL, or pass the full URL via DSH_GUI_URL (got ${base}).`,
    )
  }
  await page.goto(`${new URL(base).origin}/?${TOKEN_QUERY}=${encodeURIComponent(token)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const after = await page.textContent('body').catch(() => '')
  if (after.includes('authentication required')) {
    throw new Error('auth handshake did not produce a session — DSH_WEB_TOKEN may be stale')
  }
  return page
}