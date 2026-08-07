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
 *      flowing automatically. Replay is captured for sessions that hit an
 *      error, not for happy-path sessions — and only for roles that may be
 *      recorded (see utils/analyticsPolicy). Learner and parent sessions
 *      report the error with no recording attached.
 *
 * The existing `src/components/ui/ErrorBoundary.jsx` keeps catching
 * render errors and showing the friendly recovery card; Sentry hooks
 * the global error / unhandledrejection events so it captures both
 * React errors and async failures without us touching the boundary.
 */

import { resolveAnalyticsPolicy } from './analyticsPolicy'

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
// Same for the role: it decides whether error-replay may be enabled, and it
// can arrive before Sentry has finished loading.
let pendingRole
// The replay integration, created and registered lazily — and at most ONCE
// per page load, because Sentry's Replay class is a singleton: constructing a
// second instance throws "Multiple Sentry Session Replay instances are not
// supported". Stop-and-recreate is therefore not a lifecycle this module can
// have. `replay` keeps the one instance for the life of the page; whether it
// is currently recording is `replayActive`. Null means no instance has ever
// been built — the state for learners, for parents, and for every session
// before a recordable role is known.
let replay = null
let replayActive = false
// The in-flight stop(), if any. Sentry's stop() is async: after an error has
// promoted buffering to session mode it awaits a final flush before
// destroying the event buffer — and a startBuffering() issued while that
// teardown is pending gets torn down WITH it, silently, with our own
// replayActive still true so nothing ever retries. Re-arming therefore
// serialises behind this promise (Codex P2 on #2156, r3733994279).
let replayStopping = null

/**
 * Register Sentry's error-triggered session replay, but only for a role that
 * may be recorded. Idempotent.
 *
 * Adding the integration late (rather than filtering afterwards) is the
 * point: an integration that is not registered cannot buffer frames, so a
 * learner who hits an error on the sign-in screen produces an error report
 * with no recording attached — not a recording we later decline to upload.
 */
function enableReplayForRole(Sentry, role) {
  if (!Sentry) return
  if (!resolveAnalyticsPolicy(role).sessionRecording) return
  if (replay) {
    // The instance already exists — sign-out stopped it, it did not destroy
    // it (it cannot: Sentry allows one Replay per page load). Re-arm the
    // error-mode buffer instead of constructing a second instance, which
    // throws, and — because the catch used to null `replay` — used to retry
    // and throw again on every profile snapshot for the rest of the session,
    // leaving no replay at all.
    if (replayActive) return
    // Claim the active slot BEFORE any await, so a second snapshot in the
    // same window cannot queue a second re-arm.
    replayActive = true
    const arm = () => {
      // Re-checked at arm time: a sign-out while the stop was settling
      // withdraws the claim, and the recorder stays off.
      if (!replayActive || !replay) return
      try {
        replay.startBuffering()
      } catch (err) {
        replayActive = false
        console.warn('[sentry] replay re-arm failed:', err)
      }
    }
    // replayStopping never rejects (its own chain catches), so arm is the
    // only continuation; the trailing catch is for the linter's benefit and
    // for any future edit that removes the upstream catch.
    if (replayStopping) replayStopping.then(arm).catch(() => {})
    else arm()
    return
  }
  try {
    replay = Sentry.replayIntegration({
      // Everything on screen is masked and media blocked. Teachers' papers
      // and learners' names appear all over these screens, and a replay is
      // for reproducing a fault, not for reading the page.
      maskAllText: true,
      blockAllMedia: true,
    })
    Sentry.addIntegration(replay)
    replayActive = true
  } catch (err) {
    // A failed replay registration must never cost us the error reporting
    // itself — that is the reason Sentry is here at all.
    replay = null
    console.warn('[sentry] replay registration failed:', err)
  }
}

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
      // Never sample random sessions for replay. Error-triggered replay is
      // allowed, but ONLY once a role that may be recorded is known — see
      // enableReplayForRole(). The integration is deliberately absent from
      // this list: sample rates alone would not help, because a learner who
      // hits an error before the profile loads would already be recorded.
      //
      // This is the same rule PostHog is held to (utils/analyticsPolicy), and
      // it has to be enforced twice because "session replay" is two systems.
      // Privacy Policy §4 says we never record a learner's screen; Sentry is
      // the other place that sentence can be made false.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      // Cut common noise: ignore extension-related errors and the
      // chunk-load reload path that ErrorBoundary already handles
      // (it auto-reloads on a stale-asset chunk failure).
      ignoreErrors: [
        /Failed to fetch dynamically imported module/i,
        /Loading chunk .* failed/i,
        /Importing a module script failed/i,
        /ResizeObserver loop limit exceeded/i,
        // Benign Google reCAPTCHA SDK noise from App Check: a redundant
        // reCAPTCHA render (bfcache restore / a second init attempt) throws
        // this asynchronously. App Check still works from the first init, so
        // it's third-party noise — the one-shot guard in firebase/config.js
        // prevents our own double-init; this filters the residual.
        /reCAPTCHA placeholder element must be empty/i,
      ],
    })
    sentryModule = Sentry
    // Apply any user state that arrived before Sentry finished loading.
    if (pendingUserId !== undefined) {
      Sentry.setUser(pendingUserId === null ? null : { id: pendingUserId })
      if (pendingUserId !== null) enableReplayForRole(Sentry, pendingRole)
      pendingUserId = undefined
      pendingRole = undefined
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
export function setSentryUser(uid, role) {
  if (!uid) return
  if (sentryModule) {
    sentryModule.setUser({ id: uid })
    enableReplayForRole(sentryModule, role)
  } else {
    pendingUserId = uid
    pendingRole = role
  }
}

/**
 * Drop the Sentry user tag. Called from AuthContext on sign-out so the
 * next anonymous error isn't bucketed under the previous user.
 */
export function clearSentryUser() {
  // Stop and forget the recorder BEFORE dropping the user tag. On a shared
  // school phone the next person to sign in may be a learner, and a replay
  // left running would capture them under the previous user's permission.
  if (replay && replayActive) {
    replayActive = false
    try {
      // stop() may flush asynchronously; the promise is what a later re-arm
      // serialises behind. Errors are logged, never thrown — and the settled
      // promise clears itself so a re-arm long after does not wait on history.
      replayStopping = Promise.resolve(replay.stop())
        .catch((err) => { console.warn('[sentry] replay stop failed:', err) })
        .finally(() => { replayStopping = null })
    } catch (err) {
      console.warn('[sentry] replay stop failed:', err)
    }
    // The INSTANCE is kept — Sentry permits exactly one per page load, so
    // destroying our reference would leave re-registration with no legal
    // move. Stopped is the off state; startBuffering() is the on switch.
  }
  pendingRole = undefined
  if (sentryModule) {
    sentryModule.setUser(null)
  } else {
    pendingUserId = null
  }
}
