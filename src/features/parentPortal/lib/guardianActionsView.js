/**
 * guardianActionsView — the words and the small decisions behind the two
 * guardian screens (`/for-guardians` and `/for-guardians/request/:id`).
 *
 * Pure, so the copy a guardian reads before approving a deletion or
 * withdrawing consent is testable as data in, data out. Nothing here decides
 * whether an action is ALLOWED — the callables do that, and a refusal comes
 * back as an error to show. This only decides what to SAY.
 */

/** Childline Zambia. Shown on every screen here: it needs no guardian's leave. */
export const CHILDLINE = Object.freeze({ name: 'Childline Zambia', number: '116' })

/**
 * How a link reads to its guardian.
 *
 * `consent.state` outranks `status`: a withdrawal is recorded in `consent`
 * and cannot be expressed by `status`. A link with no `consent` object at all
 * is a legacy one, and reads as approved when `status` is active (the same
 * grace `guardianLinkCore.linkIsApproved` gives it on the server).
 *
 * @param {object} link a parentLinks document's data
 * @returns {'approved'|'withdrawn'|'pending'|'declined'|'unknown'}
 */
export function linkState(link) {
  const consent = link?.consent?.state
  if (consent === 'withdrawn') return 'withdrawn'
  if (consent === 'approved') return 'approved'
  if (consent === 'pending') return 'pending'
  const status = link?.status
  if (status === 'active') return 'approved'
  if (status === 'pending') return 'pending'
  if (status === 'declined') return 'declined'
  return 'unknown'
}

const STATE_LABEL = Object.freeze({
  approved: 'You have approved',
  withdrawn: 'You withdrew your consent',
  pending: 'Waiting for your child to confirm',
  declined: 'Declined',
  unknown: 'Status unknown',
})

export function linkStateLabel(state) {
  return STATE_LABEL[state] || STATE_LABEL.unknown
}

/** Only an approved link has anything to withdraw. */
export function canWithdraw(state) {
  return state === 'approved'
}

/**
 * What the guardian is told after withdrawing — honest about whether the
 * child is still approved through another adult.
 */
export function withdrawalMessage({ childName, childStillApproved }) {
  const name = String(childName || '').trim() || 'Your child'
  return childStillApproved
    ? `Done. ${name} is still covered by another guardian's approval, so nothing changes for them yet.`
    : `Done. ${name} keeps all their lessons and past papers. The leaderboard and purchases are paused until a guardian approves again.`
}

/**
 * The tiles the server chose to send, as display rows. A tile the server left
 * out (`null`) is omitted rather than shown as zero: "0 day streak" and "we do
 * not know" look the same on screen and mean opposite things to a parent.
 */
export function statRows(tiles) {
  const rows = []
  if (Number.isFinite(tiles?.streakDays)) {
    rows.push({ key: 'streak', label: 'Practice streak', value: `${tiles.streakDays} days` })
  }
  if (Number.isFinite(tiles?.examReadiness)) {
    rows.push({ key: 'readiness', label: 'Exam readiness', value: `${tiles.examReadiness}%` })
  }
  if (Number.isFinite(tiles?.daysToExam)) {
    rows.push({ key: 'exam', label: 'Days to their next exam', value: String(tiles.daysToExam) })
  }
  return rows
}

/** "in 5 days" / "today" for the deadline lines. Never negative. */
export function daysPhrase(days) {
  if (!Number.isFinite(days)) return null
  if (days <= 0) return 'today'
  return days === 1 ? 'in 1 day' : `in ${days} days`
}

/**
 * Which view a `getDeletionRequest` payload calls for.
 *
 * A request that is missing, or that belongs to the CHILD's side of the
 * screen, is shown as "not found" — the same answer a stranger gets, so this
 * page confirms nothing about a family it was not addressed to.
 */
export function requestView(payload) {
  const req = payload?.request
  if (!req || req.viewerIs !== 'guardian') return 'not_found'
  if (req.state === 'pending_guardian') return 'decide'
  if (req.state === 'scheduled') return 'scheduled'
  if (req.state === 'declined') return 'declined'
  if (req.state === 'cancelled') return 'cancelled'
  if (req.state === 'escalated_support') return 'escalated'
  if (req.state === 'completed') return 'completed'
  return 'not_found'
}
