/**
 * analytics — PostHog wiring for product analytics (audit B2).
 *
 * Double-gated so this is a silent no-op unless BOTH conditions hold:
 *   1. VITE_POSTHOG_KEY is set at build time
 *   2. The user has accepted the cookie consent banner (D2)
 *
 * No init = no SDK download = zero bytes shipped to a visitor who
 * declines. The lazy import keeps posthog-js out of the main bundle
 * for declined / no-config builds.
 *
 * Public API:
 *   initAnalytics()                 — call once on app boot. Subscribes
 *                                     to consent changes and (re-)inits
 *                                     when accepted, opt-outs when
 *                                     declined.
 *   identifyUser(uid, role)         — call from AuthContext on
 *                                     auth state change. Anonymous-
 *                                     to-identified handoff is handled.
 *   capture(event, properties)      — record a custom event. Drops
 *                                     silently if analytics is off.
 *   resetAnalytics()                — call on signout so the next user
 *                                     doesn't inherit the previous
 *                                     identity.
 *
 * Identity policy: UID + role only. We never send email, displayName,
 * phone, school name, payment data, or quiz / lesson IDs as super-
 * properties. Per-event properties stay as opaque ids (e.g. `quizId`
 * is fine since it's already in our own backend).
 *
 * Role policy (Privacy Policy §4 — children's privacy): consent is not
 * the only gate. utils/analyticsPolicy decides how closely a given role
 * may be observed, and learners — plus every session before a role is
 * known — get session replay off, heatmap collection off, surveys off,
 * no identify, and no IP geolocation. See that module for why the default
 * is minimise rather than observe.
 *
 * Every one of those switches must be set AT INIT as well as applied by
 * applyPolicy(). PostHog's client config defaults to "whatever the PostHog
 * project says" for recording, heatmaps and surveys alike, and the project
 * has all three enabled — so a switch this file does not name is a switch
 * that is ON for every learner, and the only evidence of it is in the
 * vendor's dashboard rather than in this repo.
 */

import {
  CONSENT_ACCEPTED,
  getConsent,
  isAnalyticsAllowed,
  onConsentChange,
} from './analyticsConsent'
import { MINIMISED_POLICY, resolveAnalyticsPolicy } from './analyticsPolicy'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com'

let posthogInstance = null
let initInFlight = null
let queuedIdentity = null

// The treatment currently in force. Starts minimised and only widens once
// identifyUser() hands us a role we can account for — so a session that
// never signs in, or hasn't finished loading its profile, is never recorded.
let activePolicy = MINIMISED_POLICY

function configured() {
  return Boolean(POSTHOG_KEY)
}

/**
 * Apply a resolved policy to a live PostHog instance. Split out so the
 * loaded() callback and identifyUser() drive the SDK through one path —
 * the failure mode being avoided is a policy that is applied on one route
 * into the SDK and forgotten on the other.
 */
function applyPolicy(instance, policy) {
  if (!instance) return
  try {
    // $geoip_disable is read server-side by PostHog's enrichment step, so it
    // must be registered as a super-property (present on every event) rather
    // than passed once at init.
    instance.register({ $geoip_disable: !policy.geoip })
  } catch (err) {
    console.warn('[analytics] geoip policy failed', err)
  }
  try {
    if (policy.sessionRecording) instance.startSessionRecording()
    else instance.stopSessionRecording()
  } catch (err) {
    console.warn('[analytics] recording policy failed', err)
  }
  try {
    // Heatmaps and surveys are separate PostHog subsystems, each with its own
    // switch, and each defaults to the value set in the PostHog PROJECT when
    // the client says nothing. Saying nothing is what we used to do, so both
    // ran for every session — including learners — while replay was correctly
    // held off. Naming them here is what makes the policy object the whole
    // policy rather than the replay half of it.
    //
    // set_config is the runtime toggle for both: it calls
    // heatmaps.startIfEnabled() (which also DISCARDS the pending coordinate
    // buffer when disabling, so nothing already collected is flushed) and
    // surveys.loadIfEnabled().
    instance.set_config({
      capture_heatmaps: policy.heatmaps,
      disable_surveys: !policy.surveys,
    })
  } catch (err) {
    console.warn('[analytics] observation policy failed', err)
  }
}

async function loadPostHog() {
  if (!configured()) return null
  if (posthogInstance) return posthogInstance
  if (initInFlight) return initInFlight

  initInFlight = (async () => {
    try {
      const { default: posthog } = await import('posthog-js')
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        // Capture pageviews automatically (covers the SPA navigation
        // path — PostHog hooks history.pushState).
        capture_pageview: true,
        // We're on a SPA — pageleave is handled via the same hook.
        capture_pageleave: true,
        // Persistence: localStorage + cookie. The cookie is short-
        // lived and consent-gated already.
        persistence: 'localStorage+cookie',
        // Don't autocapture form input *values* (privacy) — events on
        // form submission still fire, but the input strings stay
        // off the wire.
        mask_all_text: false,
        autocapture: {
          dom_event_allowlist: ['click', 'submit', 'change'],
        },
        // Session replay starts OFF for every session and is switched on
        // only by applyPolicy(), once a role that may be recorded is
        // known. Doing this at init (rather than stopping the recorder
        // after the fact) means a learner's pre-sign-in screens are never
        // captured in the first place — a recording that is stopped has
        // already been made.
        disable_session_recording: true,
        // Heatmap collection starts OFF for the same reason and by the same
        // rule. Left unset, posthog-js falls through to the PostHog project's
        // heatmaps_opt_in flag (true for this project), so every click and
        // rageclick coordinate on /login, /register and the learner pages was
        // buffered and flushed as $$heatmap regardless of who was on the
        // screen. applyPolicy() turns it on for an observable role.
        capture_heatmaps: false,
        // Surveys likewise. This one has to be set AT INIT rather than turned
        // off later: posthog-js's surveys.loadIfEnabled() early-returns once a
        // survey manager exists, so a survey system that has already loaded
        // cannot be unloaded by flipping the flag afterwards.
        disable_surveys: true,
        session_recording: {
          // Every <input>/<textarea>/<select> value is masked in the
          // recording, so a password, an email or a child's name typed
          // into a form is never in the payload even for the roles we do
          // record. Applies to the initial DOM snapshot as well as later
          // mutations.
          maskAllInputs: true,
          // Passwords are masked by maskAllInputs; naming the selector as
          // well means a future relaxation of that flag can't silently
          // unmask them.
          maskInputOptions: { password: true, email: true, tel: true },
        },
        loaded: (instance) => {
          posthogInstance = instance
          applyPolicy(instance, activePolicy)
          if (queuedIdentity) {
            const policy = resolveAnalyticsPolicy(queuedIdentity.role)
            activePolicy = policy
            applyPolicy(instance, policy)
            if (policy.identify) {
              instance.identify(queuedIdentity.uid, queuedIdentity.props)
            }
            queuedIdentity = null
          }
        },
      })
      posthogInstance = posthog
      // posthog-js exports a module SINGLETON, and init() early-returns on an
      // instance that is already loaded — without running loaded(). So on a
      // decline-then-accept cycle (teardownPostHog() nulled our reference but
      // the SDK is still there) the block above never executes, and the
      // instance would keep whatever observation settings the PREVIOUS user's
      // role left on it. Re-assert the policy and re-arm capturing here;
      // applyPolicy is idempotent, so on a genuine first init this is a no-op
      // repeat of what loaded() just did.
      applyPolicy(posthog, activePolicy)
      try {
        if (posthog.has_opted_out_capturing?.()) {
          // captureEventName: null suppresses the $opt_in event — re-arming a
          // consent decision is not itself a product event worth recording.
          posthog.opt_in_capturing({ captureEventName: null })
        }
      } catch (err) {
        console.warn('[analytics] opt-in failed', err)
      }
      return posthog
    } catch (err) {
      console.warn('[analytics] posthog init failed', err)
      return null
    } finally {
      initInFlight = null
    }
  })()

  return initInFlight
}

function teardownPostHog() {
  activePolicy = MINIMISED_POLICY
  if (!posthogInstance) return
  // Go through applyPolicy rather than stopping the recorder by hand: consent
  // being withdrawn has to switch off every observation subsystem, and a
  // hand-written list here is one that stops matching the policy object the
  // first time a new switch is added to it.
  applyPolicy(posthogInstance, MINIMISED_POLICY)
  try {
    posthogInstance.opt_out_capturing()
    posthogInstance.reset()
  } catch (err) {
    console.warn('[analytics] teardown failed', err)
  }
  posthogInstance = null
}

/**
 * Wire the consent listener + auto-load if already accepted. Idempotent;
 * safe to call from main.jsx on every boot.
 */
export function initAnalytics() {
  if (!configured()) return // silent no-op for unconfigured builds
  if (isAnalyticsAllowed()) {
    void loadPostHog()
  }
  onConsentChange((value) => {
    if (value === CONSENT_ACCEPTED) {
      void loadPostHog()
    } else {
      teardownPostHog()
    }
  })
}

/**
 * Register the signed-in user's ROLE, and identify them only if that role
 * may be identified. Buffer if PostHog hasn't finished loading yet; the
 * loaded() callback will pick it up.
 *
 * For a minimised role (learner, parent, anything unrecognised) this is the
 * point where the treatment is applied but the identity is deliberately NOT
 * sent: the uid never reaches PostHog, so events stay on the anonymous
 * distinct_id and there is no person profile to link them to.
 */
export function identifyUser(uid, role) {
  if (!uid) return
  const policy = resolveAnalyticsPolicy(role)
  activePolicy = policy
  // Only role + uid, and only for roles we identify at all. No email /
  // no displayName / no school, ever.
  const props = { role: role || 'unknown' }
  if (posthogInstance) {
    applyPolicy(posthogInstance, policy)
    if (!policy.identify) return
    try {
      posthogInstance.identify(uid, props)
    } catch (err) {
      console.warn('[analytics] identify failed', err)
    }
  } else if (configured() && getConsent() === CONSENT_ACCEPTED) {
    // SDK still loading — queue the role so loaded() can apply the same
    // decision. The uid rides along but is only ever used when the policy
    // permits identifying.
    queuedIdentity = { uid, role, props }
    void loadPostHog()
  }
}

/**
 * Reset on signout so the next user (e.g. shared phone) doesn't
 * inherit the previous identity. PostHog's reset() rotates the
 * distinct_id back to a fresh anonymous one.
 */
export function resetAnalytics() {
  queuedIdentity = null
  // Back to minimised: the next session on this device is unknown until it
  // signs in, and on a shared school phone the next user may well be a
  // learner. Recording must stop BEFORE the identity is rotated, or the
  // first frames of the next session belong to the new user.
  activePolicy = MINIMISED_POLICY
  if (!posthogInstance) return
  applyPolicy(posthogInstance, activePolicy)
  try { posthogInstance.reset() } catch (err) {
    console.warn('[analytics] reset failed', err)
  }
}

/**
 * Record an event. Drops silently when analytics is off — call sites
 * shouldn't have to repeat the configured/consent guard everywhere.
 */
export function capture(event, properties = {}) {
  if (!event || !posthogInstance) return
  try {
    posthogInstance.capture(event, properties)
  } catch (err) {
    console.warn('[analytics] capture failed', err)
  }
}
