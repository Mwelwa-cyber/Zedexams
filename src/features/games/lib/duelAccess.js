/**
 * May this account race Zed?
 *
 * One predicate, read by the games hub's card and by the /games/duel route
 * itself, so the card cannot offer a race the page then refuses.
 *
 * ── Why this is not `isAllowed(profile, 'challenges')` on its own ────────
 *
 * `readGuardianControls` fails SAFE on a profile it cannot read: an absent
 * or malformed value is `null` — "no guardian has expressed a view" — never
 * `false`. That is the right default and it means an unloaded profile
 * already falls open here.
 *
 * What this adds is the surrounding question of WHO is asking. A signed-out
 * visitor has no guardian record at all, and a teacher or admin who opens
 * /games is not somebody's child. Neither should be run through a control
 * that only means something for a learner, so both are answered before the
 * control is consulted.
 *
 * The failure this avoids is a specific sentence: "challenges are switched
 * off for this account", shown to someone whose guardian never switched
 * anything off, pointing them at a parent with nothing to turn back on.
 */

import { isAllowed } from '../../../utils/guardianControls.js'

/**
 * @param {object|null} currentUser  the Firebase auth user, or null
 * @param {object|null} userProfile  the users/{uid} document, if loaded
 * @return {boolean}
 */
export function duelAllowed(currentUser, userProfile) {
  // Signed-out visitors keep the race: there is no guardian record to read,
  // and the route writes nothing for them.
  if (!currentUser) return true
  // Only a learner has a guardian whose view this could be.
  if (userProfile?.role !== 'learner') return true
  return isAllowed(userProfile, 'challenges')
}
