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
import { buildReleaseName } from './releaseName'

// Assembled by utils/releaseName so this string and the one vite.config.js
// stamps on the uploaded source maps come from the same function rather than
// from two hand-synchronised template literals. Includes the build sha, so a
// deploy is distinguishable from the one before it — see that module for why
// that turned out to matter.
const RELEASE = buildReleaseName({
  version: import.meta.env.VITE_APP_VERSION,
  sha: import.meta.env.VITE_BUILD_SHA,
  mode: import.meta.env.MODE,
})

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
// Whether Firebase Auth has resolved yet, mirrored onto every event as a tag.
// Set from the very first render — long before Sentry has finished loading —
// so it needs the same stash-and-apply treatment as the user id.
let pendingAuthState
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
        // The invisible App Check widget's own expiry timer, rejecting a
        // promise nobody owns. Google's recaptcha__en.js rejects with
        // "reCAPTCHA Timeout (b)" from a background timer, so it reaches us
        // through onunhandledrejection with handled=no and a two-frame stack
        // that is entirely third-party — an error-level issue that names no
        // user flow, on a page where nobody has done anything (the landing
        // page, no sign-in, no upload).
        //
        // It is filtered rather than fixed because a reCAPTCHA timeout is a
        // case we already handle by design, and BETTER instrumented from our
        // own side than from Google's stack:
        //   • Auth/Firestore fail open — resilientGetToken() races the mint
        //     against 5s and resolves a placeholder, so nothing stalls
        //     (firebase/appCheckResilient.js, the 2026-07-01 outage).
        //   • A Storage WRITE is the one path with real consequence, and it
        //     refuses through appCheckWriteGate with a reason the UI can state
        //     honestly (WRITE_PLACEHOLDER) — that is the event worth counting.
        //   • Standing attestation health is on /admin/app-check.
        // So dropping this loses no signal; keeping it buries the ones above.
        // Deliberately narrow: it must not swallow a DIFFERENT reCAPTCHA
        // failure, which is why it matches the timeout wording and not /^reCAPTCHA/.
        /reCAPTCHA Timeout/i,
      ],
    })
    sentryModule = Sentry
    if (pendingAuthState !== undefined) {
      Sentry.setTag('auth.state', pendingAuthState)
      pendingAuthState = undefined
    }
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

/**
 * Record where Firebase Auth has got to, as a tag on every subsequent event.
 *
 * `'unresolved'` → `'resolved'` on the first `onAuthStateChanged`, or
 * `'wedged'` when the restoration watchdog concludes initialisation failed.
 *
 * This exists because of how PYTHON-K read in triage. `setSentryUser` is only
 * called from the auth callback, so an error that PREVENTS that callback can
 * never carry a user — and the issue therefore reported "Users impacted: 0"
 * for eight days while it was logging people out. Zero was an artefact of the
 * failure, not a measure of it. A tag that is present on the event regardless
 * of whether a user could be attached is the honest version of that signal.
 */
export function setAuthStateTag(state) {
  if (sentryModule) sentryModule.setTag('auth.state', state)
  else pendingAuthState = state
}

/**
 * Report that Firebase Auth never initialised, as a first-party named event.
 *
 * Without this the only trace is Firebase's own rejected floating promise,
 * which arrives as an unhandled rejection with a stack that is entirely
 * third-party and names no user flow — so triage sees a vendor error rather
 * than "a signed-in session could not be restored".
 *
 * `hadSessionHint` is a TAG rather than a detail because it is the closest
 * honest stand-in for user impact: we cannot know the uid (resolving it is the
 * very thing that failed), but we do know this device had a live session, so
 * a real person was affected even though the event carries no user.
 *
 * Only called for hinted devices. A slow cold start on a signed-out visitor is
 * ordinary and must not page anyone.
 */
export function reportAuthInitFailure({ action, viaFastPath, documentHidden, hidDuringInit, recoveryAttempted, attempt, errorCode }) {
  // No Sentry loaded means no DSN configured, so there is nothing to be blind
  // about — dropping the report is correct rather than a lost signal.
  if (!sentryModule) return
  try {
    // A retry is not a failure yet — it is the system doing its job, and
    // filing it at `error` would page someone for every flaky mobile link.
    // It is still reported: without it the ladder is invisible, and the only
    // events in triage would be the ones where it did not work.
    const isRetry = action === 'retry'
    // A rescue is its own event, not a wedge. The SDK DID initialise — it
    // finished by throwing the session away over a failed boot check, and the
    // guard kept it. Filing that under "never completed" would merge two
    // different failures into one issue and hide which one is actually
    // happening. `warning`, because the session survived.
    const isRescue = action === 'session-rescued'
    sentryModule.captureMessage(
      isRescue
        ? 'Auth boot check failed — stored session rescued'
        : isRetry ? 'Auth initialisation retrying' : 'Auth initialisation never completed',
      {
        level: isRetry || isRescue ? 'warning' : 'error',
        tags: {
          'auth.init_failure': !isRetry && !isRescue,
          'auth.session_rescued': isRescue,
          'auth.had_session_hint': true,
          'auth.recovery_action': action,
          'auth.detected_via': viaFastPath ? 'rejection' : 'watchdog',
        },
        contexts: {
          authInit: {
            action,
            detectedVia: viaFastPath ? 'unhandled-rejection' : 'watchdog-timeout',
            documentHidden,
            hidDuringInit,
            recoveryAttempted,
            // Which rung of the backoff ladder this is, and what the token
            // reload actually said — the two things that separate "the link
            // dropped" from "the credential is dead" in triage.
            attempt: attempt ?? null,
            errorCode: errorCode ?? null,
          },
        },
      },
    )
  } catch (err) {
    console.warn('[sentry] auth-init failure report failed:', err)
  }
}
