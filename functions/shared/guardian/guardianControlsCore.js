// functions/shared/guardian/guardianControlsCore.js
//
// ⚠️ SHARED WITH THE FRONTEND. Guardian controls — the permissions a
// guardian sets over their child's account from the Guardian Zone.
//
// It lives here, not in src/, for the reason functions/shared/README.md
// gives: what this module decides is whether a child may reach an AI, and
// a rule that lives only in the browser is not a rule. The server reads it
// in consentGuard.assertLearnerCapability (so BOTH the aiChat callable and
// an SSE endpoint are covered by one check) and the client
// reaches it through src/utils/guardianControls.js.
//
// Plain ESM: no React, no DOM, no Firebase. Tested under plain node by
// scripts/test-guardian-controls.mjs.
//
// The shape is deliberately three-valued. A control is `true` (the
// guardian allowed it), `false` (the guardian turned it off) or `null`
// (no guardian has ever expressed a view). Only the middle case is a
// restriction. Collapsing null onto a default would make every account
// that never opened the zone look like a guardian decision, and then a
// later change to that default would silently rewrite decisions parents
// believe they made.
//
// Where it lives: `users/{uid}.guardianControls`. That field is on the
// self-update blocklist in firestore.rules, so the CHILD's client cannot
// write it — every change goes through the setGuardianControl callable,
// which requires an approved guardian on the account, records an audit
// entry, and emails the guardian. See functions/guardianControls/.
//
// What "enforced" means here, precisely, and it is NOT the same for every
// control — see the `enforcement` field below. A 'server' control is read
// SERVER-SIDE at the point of use, so turning it off is not a UI courtesy a
// modified client can ignore. A 'client' control removes the surface and refuses
// the route, and nothing re-checks behind that; it is reserved for solo
// activities, where what a guardian is expressing is a preference about
// time rather than a safety boundary. Recording the difference as data is
// how the weaker one avoids inheriting the stronger one's reputation.
//
// What NEITHER is, is tamper-proof against the child themselves — the
// in-app zone runs in the child's own session behind a friction gate, so
// a child who reached the callable directly could flip a control back.
// That is why every change is audited and mailed to the guardian: the
// guarantee offered is "cannot be changed silently", not "cannot be
// changed".

/**
 * Every control, with the human label used in the audit trail + email.
 *
 * `enforcement` records where the OFF actually bites, and it is a field
 * rather than a comment because the two are not equally strong and a
 * parent should not be told they are:
 *
 *   'server' — read at the point of use in consentGuard, so a modified
 *              client cannot ignore it. `test:guardian-controls` fails if
 *              a control claims this and consentGuard never reads it.
 *   'client' — the surface is removed and the route refuses, but nothing
 *              server-side re-checks. Honest for a control whose subject
 *              is a solo activity: Race Zed involves no other people (the
 *              opponent is our robot), so what a guardian is expressing is
 *              a preference about how their child spends time, not a
 *              safety boundary. Gating the score write would mean a
 *              cross-service read in a rules predicate, which this repo
 *              has already paid for once — see the Storage-rules incident
 *              in CLAUDE.md.
 */
export const GUARDIAN_CONTROLS = Object.freeze([
  {
    key: 'challenges',
    label: 'Live challenges',
    hint: 'Racing our robot coach — never another child',
    icon: '⚔️',
    enforcement: 'client',
  },
])

export const GUARDIAN_CONTROL_KEYS = Object.freeze(GUARDIAN_CONTROLS.map((c) => c.key))

/** True when `key` is a control this build knows how to enforce. */
export function isGuardianControl(key) {
  return GUARDIAN_CONTROL_KEYS.includes(key)
}

/**
 * Read the stored controls off a user document into the three-valued
 * shape above. Anything that is not a boolean — absent, a string, a
 * number written by an older client — reads as `null` (no decision),
 * never as `false`: inventing a restriction nobody set is the one
 * failure mode a parent would never be able to explain to their child.
 */
export function readGuardianControls(user) {
  const raw = user && typeof user === 'object' && user.guardianControls
  const src = raw && typeof raw === 'object' ? raw : {}
  const out = {}
  for (const key of GUARDIAN_CONTROL_KEYS) {
    out[key] = typeof src[key] === 'boolean' ? src[key] : null
  }
  return out
}

/**
 * The effective answer for one control: is the child allowed to use it?
 *
 * `learnerChoice` is the child's own preference. The guardian's `false`
 * always wins; the guardian's `true` does NOT override a child who
 * switched it off themselves — a parent permitting something is not a
 * parent requiring it.
 */
export function isAllowed(user, key, learnerChoice = true) {
  if (!isGuardianControl(key)) return true
  const controls = readGuardianControls(user)
  if (controls[key] === false) return false
  return learnerChoice !== false
}

/**
 * Describe a change for the audit entry and the guardian's email, in
 * plain words rather than field names — the message a parent gets should
 * read like a sentence, not a diff.
 */
export function describeControlChange(key, value) {
  const meta = GUARDIAN_CONTROLS.find((c) => c.key === key)
  if (!meta) return null
  return `${meta.label} was turned ${value ? 'on' : 'off'}`
}
