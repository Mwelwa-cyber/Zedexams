/**
 * Sentry error monitoring — DSN-gated, dynamic-import scaffolding.
 *
 * The @sentry/react package only loads when VITE_SENTRY_DSN is set in the
 * environment. With no DSN, this file resolves to a no-op and the package
 * is tree-shaken out of the bundle entirely (verified by checking the
 * production build output — no Sentry chunks appear unless DSN is set).
 *
 * Why dynamic import: the team isn't on Sentry yet, so we shouldn't pay
 * the bundle cost (≈ 80 kB raw / 25 kB gz) until they sign up. Once the
 * DSN is set in .env, the next build inlines Sentry and errors flow.
 *
 * To enable:
 *   1. Sign up at https://sentry.io/ → create a Project (React).
 *   2. Copy the DSN.
 *   3. Add to .env (and Firebase Hosting environment if needed):
 *        VITE_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
 *   4. Redeploy. Errors and a 10 % sample of performance traces start
 *      flowing automatically. Replay is captured for sessions that hit
 *      an error, not for happy-path sessions.
 *
 * The existing `src/components/ui/ErrorBoundary.jsx` keeps catching
 * render errors and showing the friendly recovery card; Sentry hooks
 * the global error / unhandledrejection events so it captures both
 * React errors and async failures without us touching the boundary.
 */

const RELEASE =
  // Vite injects MODE; APP_VERSION is bumped manually in package.json (1.1.0
  // at time of writing). Pair them so a regression report tells you which
  // build it came from without needing a separate release tag.
  `zedexams@${import.meta.env.VITE_APP_VERSION ?? 'dev'}-${import.meta.env.MODE}`

// Module reference, captured once Sentry has finished its async load.
// Stays null when VITE_SENTRY_DSN isn't set, in which case all the
// helpers below are no-ops.
let sentryModule = null

// AuthContext can call setSentryUser/clearSentryUser before initSentry
// has resolved (signed-in user on first page load). Stash the latest
// state and apply it once Sentry is ready. Sentinel `undefined` means
// "no state set yet"; `null` means "explicitly cleared".
let pendingUserId

export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  try {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      release: RELEASE,
      environment: import.meta.env.MODE,
      // Keep traces light; this isn't an APM tool, just an error sink.
      tracesSampleRate: 0.1,
      // Only capture replays around errors — never random sessions —
      // because learners are minors and we don't want to record them
      // for the sake of debugging.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      // Cut common noise: ignore extension-related errors and the
      // chunk-load reload path that ErrorBoundary already handles
      // (it auto-reloads on a stale-asset chunk failure).
      ignoreErrors: [
        /Failed to fetch dynamically imported module/i,
        /Loading chunk .* failed/i,
        /Importing a module script failed/i,
        /ResizeObserver loop limit exceeded/i,
      ],
    })
    sentryModule = Sentry
    // Apply any user state that arrived before Sentry finished loading.
    if (pendingUserId !== undefined) {
      Sentry.setUser(pendingUserId === null ? null : { id: pendingUserId })
      pendingUserId = undefined
    }
  } catch (err) {
    // Don't let a Sentry init failure block the app from booting.
    console.warn('[sentry] init failed:', err)
  }
}

/**
 * Tag the current Sentry session with the signed-in user's UID. Called
 * from AuthContext when onAuthStateChanged fires with a user. Only the
 * UID is sent — no email, displayName, or other PII — because learners
 * are minors and we want the smallest possible PII surface for a
 * support-triage tool.
 *
 * Safe to call before initSentry has resolved; the UID is stashed and
 * applied once Sentry is ready. Safe to call when DSN is unset; this
 * is a no-op.
 */
export function setSentryUser(uid) {
  if (!uid) return
  if (sentryModule) {
    sentryModule.setUser({ id: uid })
  } else {
    pendingUserId = uid
  }
}

/**
 * Drop the Sentry user tag. Called from AuthContext on sign-out so the
 * next anonymous error isn't bucketed under the previous user.
 */
export function clearSentryUser() {
  if (sentryModule) {
    sentryModule.setUser(null)
  } else {
    pendingUserId = null
  }
}
