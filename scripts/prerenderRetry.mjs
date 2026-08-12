/* global console */
/**
 * Retry + validation policy for scripts/prerender.mjs.
 *
 * Puppeteer-free on purpose — the same rationale as prerenderRoutes.mjs and
 * prerenderHeadDedup.mjs: the logic that decides whether a production deploy
 * lives or dies belongs in a module the node suite can import and drive
 * without launching Chromium.
 *
 * Why this exists. "Prerender public routes" was the last failing step on
 * main. Four sampled failures each died on a DIFFERENT single route with the
 * same error:
 *
 *   run #2005  /blog/how-to-revise-week-by-week      Waiting failed: 30000ms exceeded
 *   run #1987  /games/g/5                            Waiting failed: 30000ms exceeded
 *   run #1970  /blog/ecz-grade-7-past-papers-guide   Waiting failed: 30000ms exceeded
 *   run #1967  /games                                Waiting failed: 30000ms exceeded
 *
 * One route out of 23, never the same one twice, spread across unrelated
 * route families (static blog markdown and Firestore-backed games pages).
 * That shape is a transient Chromium scheduling stall on a shared CI runner,
 * not a broken route.
 *
 * prerender.mjs already had an attempt budget (MAX_ROUTE_ATTEMPTS = 2), but
 * the retry only fired for isRecoverableBrowserError() — CDP-level "Target
 * closed" style failures where the browser process itself is gone. A render
 * gate timeout fell straight through to the failure list, so one stall on
 * any one route cost the whole deploy.
 *
 * What changed: a gate timeout is now retryable, on a fresh page.
 *
 * What deliberately did NOT change: the 30s budget, the MIN_ROOT_TEXT
 * content floor, the SEO title check and the exact-canonical check all still
 * apply, unweakened, on EVERY attempt. So:
 *
 *   - a route that genuinely cannot render stalls twice and still fails the
 *     build — a real breakage costs 30 extra seconds, not a green deploy;
 *   - a route that renders but fails a content/canonical gate is NEVER
 *     retried and never accepted, because re-rendering a regression would
 *     only give a broken build a second chance to look green.
 *
 * The retry buys a transient stall one more window. It cannot launder a real
 * regression into a passing deploy.
 */

/** Attempts per route: one real try, plus one retry for a transient stall. */
export const MAX_ROUTE_ATTEMPTS = 2

/**
 * Minimum trimmed #root text before we trust a route has actually painted
 * (guards against snapshotting an empty shell or a crash screen).
 */
export const MIN_ROOT_TEXT = 200

/** Every prerendered route must self-canonicalise to this origin. */
export const CANONICAL_ORIGIN = 'https://zedexams.com'

/**
 * Browser-process / CDP level failure: the browser is gone or the session is
 * unusable. Recovering needs a whole new browser, not just a new page.
 */
export function isRecoverableBrowserError(err) {
  const message = err?.message || String(err || '')
  return (
    message.includes('Target.createTarget') ||
    message.includes('Session with given id not found') ||
    message.includes('Target closed') ||
    message.includes('Connection closed')
  )
}

/**
 * The render gate (or the navigation before it) ran out of its budget. The
 * browser is still healthy — the page just never reached "#root holds at
 * least MIN_ROOT_TEXT chars AND link[rel=canonical] has an href" in time.
 * Puppeteer surfaces these as TimeoutError, with messages like
 * "Waiting failed: 30000ms exceeded" (waitForFunction) or
 * "Navigation timeout of 30000 ms exceeded" (goto). We match on the name AND
 * on the message text, because the name is lost whenever the error is
 * re-thrown as a plain Error on the way out.
 */
export function isRenderGateTimeout(err) {
  const message = err?.message || String(err || '')
  return (
    err?.name === 'TimeoutError' ||
    message.includes('Waiting failed:') ||
    message.includes('Navigation timeout') ||
    /\d+\s*ms exceeded/.test(message)
  )
}

/**
 * Decide what to do with an error thrown while rendering a route.
 *
 * Returns { reason, retry, relaunchBrowser }, where reason is one of
 * 'browser' (dead browser), 'gate-timeout' (stalled render), or 'fatal'
 * (anything else — never retried).
 */
export function classifyRouteError(err, options = {}) {
  const { attempt = 1, maxAttempts = MAX_ROUTE_ATTEMPTS } = options
  const browserLost = isRecoverableBrowserError(err)
  const gateTimeout = !browserLost && isRenderGateTimeout(err)
  let reason = 'fatal'
  if (browserLost) reason = 'browser'
  else if (gateTimeout) reason = 'gate-timeout'
  return {
    reason,
    relaunchBrowser: browserLost,
    retry: reason !== 'fatal' && attempt < maxAttempts,
  }
}

/**
 * The SEO gates, unchanged from the inline version they replace. Returns a
 * failure string, or null when the snapshot is fit to write to disk.
 *
 * These are validation failures, not transient ones, so they are reported
 * straight through without a retry.
 */
export function validateSnapshot(route, snapshot, options = {}) {
  const { minRootText = MIN_ROOT_TEXT, origin = CANONICAL_ORIGIN } = options
  if (!snapshot) return `${route}: renderer returned no snapshot`
  const { title = '', canonical = null, rootLen = 0 } = snapshot
  const expectedCanonical = `${origin}${route}`
  if (rootLen < minRootText) {
    return `${route}: too little content (${rootLen} chars)`
  }
  if (!title.includes('ZedExams')) {
    return `${route}: missing SEO title (got "${title}")`
  }
  if (canonical !== expectedCanonical) {
    return `${route}: canonical "${canonical}" != "${expectedCanonical}"`
  }
  return null
}

/**
 * Render one route, retrying a transient stall once on a fresh page.
 *
 * Collaborators are injected so scripts/test-prerender-retry.mjs can drive
 * the real policy without Chromium:
 *
 *   renderRoute(route, { attempt })   Resolve to a snapshot
 *                                     { html, title, canonical, rootLen }.
 *                                     MUST own its page lifecycle (open at
 *                                     the top, close in a finally) so that
 *                                     every attempt runs on a fresh page.
 *   onSuccess(route, snapshot, meta)  Persist a snapshot that passed the gates.
 *   relaunchBrowser()                 Replace a dead browser. Called only for
 *                                     reason === 'browser'; a gate timeout
 *                                     keeps the browser and just takes a new
 *                                     page, which is far cheaper.
 *
 * Returns null on success, or the failure string to add to the build's
 * failure list.
 */
export async function prerenderRouteWithRetry(route, deps = {}) {
  const {
    renderRoute,
    onSuccess = async () => {},
    relaunchBrowser = async () => {},
    maxAttempts = MAX_ROUTE_ATTEMPTS,
    minRootText = MIN_ROOT_TEXT,
    origin = CANONICAL_ORIGIN,
    log = console,
  } = deps

  if (typeof renderRoute !== 'function') {
    throw new TypeError('prerenderRouteWithRetry: renderRoute must be a function')
  }

  let lastMessage = 'no attempt ran'
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const snapshot = await renderRoute(route, { attempt })
      const failure = validateSnapshot(route, snapshot, { minRootText, origin })
      if (failure) return failure
      await onSuccess(route, snapshot, { attempt })
      return null
    } catch (err) {
      lastMessage = err?.message || String(err)
      const decision = classifyRouteError(err, { attempt, maxAttempts })
      if (!decision.retry) return `${route}: ${lastMessage}`
      log.warn(
        `[prerender] ${decision.reason} on ${route} ` +
          `(attempt ${attempt}/${maxAttempts}) — retrying on a fresh page: ${lastMessage}`,
      )
      if (decision.relaunchBrowser) await relaunchBrowser()
    }
  }
  // Unreachable while classifyRouteError gates on attempt < maxAttempts, but
  // kept so that a future change to the budget cannot fall out of the loop
  // silently and report success for a route that never rendered.
  return `${route}: ${lastMessage}`
}
