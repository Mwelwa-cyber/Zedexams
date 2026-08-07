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
// The learner-visible INTENT: should the recorder be running for the current
// session? Claimed synchronously on an eligible sign-in, withdrawn on
// sign-out — so one snapshot's claim stops the next snapshot re-queueing.
let replayActive = false
// Whether the recorder is ACTUALLY armed. Diverges from `replayActive` while
// a queued transition is waiting its turn on the chain below; the stop task
// reads this so a sign-out whose queued re-arm never ran does not stop an
// already-stopped recorder.
let replayArmed = false
// ONE serialised chain for every recorder transition. Sentry's stop() is
// async — after an error has promoted buffering to session mode it awaits a
// final flush before destroying the event buffer, and a startBuffering()
// issued while that teardown is pending gets torn down WITH it, silently
// (Codex P2 on #2156, r3733994279). #2158's first fix kept only the LATEST
// stop's promise, which a second sign-out replaced — its no-op stop settled
// first and the next re-arm fired under the ORIGINAL flush still in flight
// (Codex P2 on #2158, r3734356773). Every transition now appends to one
// chain, in order, and never replaces what it is waiting on.
let replayChain = Promise.resolve()
// Bumped on every sign-out. A queued re-arm carries the generation it was
// queued in and refuses to run if a sign-out has intervened — withdrawal by
// token, not by mutating shared state the queue is also reading.
let replayGeneration = 0

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
    // Claim the slot BEFORE any await, so a second snapshot in the same
    // window cannot queue a second re-arm; remember the generation so a
    // sign-out BEFORE this re-arm's turn on the chain withdraws it.
    replayActive = true
    const generation = replayGeneration
    replayChain = replayChain.then(() => {
      if (generation !== replayGeneration || !replay) return
      try {
        replay.startBuffering()
        replayArmed = true
      } catch (err) {
        replayActive = false
        console.warn('[sentry] replay re-arm failed:', err)
      }
    }).catch(() => {})
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
    replayArmed = true
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
    replayGeneration += 1
    if (replayArmed) {
      // The recorder is CAPTURING, so stop() must begin NOW, in this same
      // task — queueing even the invocation defers it a microtask, and React
      // can commit the next user's UI in that gap while the previous user's
      // recorder is still rolling (Codex P1 on #2160, r3734894933). Invoking
      // synchronously is safe here: `replayArmed` is only ever set by a
      // transition that has already RUN, so nothing can be pending ahead of
      // this stop on the chain. Only the FLUSH is asynchronous, and its
      // promise joins the chain so a later re-arm still waits behind it.
      replayArmed = false
      let stopping
      try {
        stopping = Promise.resolve(replay.stop())
          .catch((err) => { console.warn('[sentry] replay stop failed:', err) })
      } catch (err) {
        console.warn('[sentry] replay stop failed:', err)
        stopping = Promise.resolve()
      }
      replayChain = replayChain.then(() => stopping).catch(() => {})
    }
    // NOT armed: the claim being withdrawn belongs to a QUEUED re-arm that
    // has not run — and the generation bump above withdraws it, so it never
    // will. There is nothing recording and nothing to stop; appending a
    // conditional stop task here is how r3734356773's early-settling no-op
    // promise crept in the first time.
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
