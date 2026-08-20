/**
 * What a child can do while they wait, and what is still off.
 *
 * The waiting screen names both lists, and it does two things by naming them:
 * it stops the wait reading as a punishment, and it gives the child a concrete
 * reason to go and nudge their grown-up. A screen that says only "waiting for
 * approval" produces a child who closes the app.
 *
 * ── The lists are DERIVED, never typed out ───────────────────────────────
 *
 * Both come from the capability sets the server actually enforces
 * (functions/shared/consent/guardianConsentCore.js). A hand-written list is a
 * promise nobody checks: the day a capability moves between the sets, a typed
 * list keeps telling a child that something works when the server refuses it,
 * or that something is locked when it is not. Copy that lies to a ten-year-old
 * about their own account is worse than no copy.
 *
 * ── Money is the one thing we do not advertise ───────────────────────────
 *
 * PURCHASE is gated, and it is deliberately absent from the "switches on
 * later" list. The product's standing rule is that an under-18 learner is
 * never shown a price (see src/services/entitlements — the guardian ask sheet
 * imports no pricing module at all), and listing "buying things" among the
 * rewards of getting approved is a price tag with extra steps.
 */

import { CAPABILITY, FULL_CAPABILITY_SET, LIMITED_CAPABILITY_SET } from '../../../utils/guardianConsent'

/**
 * The surfaces BROWSE actually buys, in a child's words. Three concrete
 * things beat one abstract one: "all your lessons and notes" is something a
 * learner recognises, "browse" is a capability name.
 */
export const AVAILABLE_NOW = Object.freeze([
  'All your lessons and notes',
  'Past papers',
  'Practice quizzes',
])

// What each still-locked capability is called on a child's screen. A
// capability with no entry here is not shown at all, which is how PURCHASE
// stays off the list without a special case in the renderer.
const LOCKED_LABELS = Object.freeze({
  [CAPABILITY.LEADERBOARD]: 'The weekly leaderboard',
  [CAPABILITY.SOCIAL]: 'Playing against friends',
})

/**
 * The capabilities that switch on when a guardian says yes, labelled for a
 * child. Derived from the difference between the two sets, so it cannot drift
 * from what the server does.
 *
 * @return {string[]}
 */
export function lockedUntilApproved() {
  return FULL_CAPABILITY_SET
    .filter((capability) => !LIMITED_CAPABILITY_SET.includes(capability))
    .map((capability) => LOCKED_LABELS[capability])
    .filter(Boolean)
}
