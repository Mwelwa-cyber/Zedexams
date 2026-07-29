/**
 * analyticsPolicy — who we are allowed to observe, and how closely.
 *
 * Consent (utils/analyticsConsent) answers "may we collect anything at all".
 * This module answers the second question consent cannot: "given that we may,
 * how much is appropriate for THIS user". The two are independent gates and
 * both must pass — a learner who opts in still gets the minimised treatment,
 * because opt-in from a nine-year-old is not the thing that makes screen
 * recording appropriate.
 *
 * The rule, from the Privacy Policy §4 (Children's privacy): ZedExams serves
 * Grade 4–7 learners, typically aged 9–12. Learner accounts are excluded from
 * session replay, are never identified to the analytics vendor, and have IP
 * geolocation suppressed. What remains is anonymous usage counts.
 *
 * ── Why the default is minimise, not observe ──────────────────────────────
 *
 * Role is not known at boot. PostHog initialises on consent, but the signed-in
 * user's role only arrives later, from AuthContext, once the profile has been
 * read. Between those two moments a session already exists — and the pages in
 * that window (the landing page, /login, /register) are exactly where a child
 * types. A policy that starts permissive and tightens on identify would record
 * that window for every learner on the platform, and the recording would
 * already be on the wire by the time we learned we should not have made it.
 *
 * So `null` (unknown / signed out / still loading) resolves to the SAME
 * minimised treatment as `learner`. Replay begins only once a role we can
 * positively account for is in hand. The cost is that anonymous marketing-page
 * replay is not collected; the benefit is that the policy sentence "learner
 * accounts are excluded from session replay" is true of the code rather than
 * true of our intentions.
 *
 * Pure module — no PostHog import, no DOM, no side effects — so the decision
 * is testable on its own under plain `node` (analyticsPolicy.test.js).
 */

// Roles that may be observed in full. An explicit allow-list, not a
// learner-deny-list: a role nobody has thought about yet must land on the
// minimised side until someone decides otherwise, which is a decision worth
// making deliberately rather than inheriting.
//
// `parent` (ROLES.PARENT) is deliberately NOT here even though a parent is an
// adult who can consent for themselves. The parent portal renders their
// child's results, so a replay of a parent's screen is a recording of a
// learner's progress data — the thing §4 is protecting — and consent from the
// parent doesn't change whose data is on the screen.
export const OBSERVABLE_ROLES = Object.freeze(['teacher', 'admin', 'superAdmin'])

// The treatment applied to learners, signed-out visitors, and any role we
// don't recognise. Frozen so a caller can't mutate the shared object and
// quietly widen the policy for everyone else.
const MINIMISED = Object.freeze({
  // Never call posthog.identify(). The distinct_id stays the anonymous one
  // PostHog minted, so events aggregate without naming an account.
  identify: false,
  // No screen recording, at all.
  sessionRecording: false,
  // Suppress PostHog's IP→location enrichment (country/city/lat/long/postal).
  // Set as a super-property; PostHog drops the enrichment server-side.
  geoip: false,
  // Events still flow — anonymous counts are what §4 permits.
  capture: true,
})

const FULL = Object.freeze({
  identify: true,
  sessionRecording: true,
  geoip: true,
  capture: true,
})

/**
 * Resolve the analytics treatment for a role.
 *
 * @param {string|null|undefined} role  users/{uid}.role, or null when signed
 *                                      out / not yet loaded.
 * @return {{identify: boolean, sessionRecording: boolean, geoip: boolean,
 *           capture: boolean}}
 */
export function resolveAnalyticsPolicy(role) {
  if (typeof role !== 'string') return MINIMISED
  return OBSERVABLE_ROLES.includes(role.trim()) ? FULL : MINIMISED
}

/**
 * Convenience predicate for the one rule the Privacy Policy states outright,
 * so a reader of the policy can grep for it and find the code that enforces it.
 */
export function isMinimisedRole(role) {
  return resolveAnalyticsPolicy(role).sessionRecording === false
}

export const MINIMISED_POLICY = MINIMISED
export const FULL_POLICY = FULL
