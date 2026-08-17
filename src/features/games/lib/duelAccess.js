/**
 * May this account race Zed?
 *
 * One predicate, read by the hub card and by the route itself, so the card
 * cannot offer a race the page then refuses.
 *
 * ── Why this is not simply `canLearnerUse(SOCIAL, profile)` ──────────────
 *
 * `resolveLearnerAccess` fails CLOSED on a profile it cannot read — no
 * document, a role it does not recognise, a document still being repaired by
 * bootstrapMissingProfile. That posture is exactly right for Ask Zed, where
 * the thing on the other side is a child conversing with an AI without a
 * parent's approval, and the cost of being wrong for a moment is a greyed-out
 * button.
 *
 * It is the wrong posture here. Race Zed involves no other people — the
 * opponent is openly our robot — so an unreadable profile is not evidence a
 * guardian said no, and treating it as one puts "challenges are switched off
 * for this account" in front of a learner whose profile simply has not
 * arrived yet. That sentence names a decision nobody made, and the parent it
 * sends them to has nothing to turn back on.
 *
 * So the block requires a profile we can actually read AS A LEARNER. A real
 * learner document always carries `role: 'learner'`, so limited mode and the
 * guardian's switch both still bite; only the states that mean "we do not
 * know yet" fall open.
 */

import { canLearnerUse, CAPABILITY } from '../../../utils/guardianConsent.js'

/**
 * @param {object|null} currentUser  the Firebase auth user, or null
 * @param {object|null} userProfile  the users/{uid} document, if loaded
 * @return {boolean}
 */
export function duelAllowed(currentUser, userProfile) {
  // Signed-out visitors keep the race: there is no guardian record to read,
  // and the route writes nothing for them.
  if (!currentUser) return true
  // Not readable as a learner → not a denial. See the header.
  if (userProfile?.role !== 'learner') return true
  return canLearnerUse(CAPABILITY.SOCIAL, userProfile)
}
