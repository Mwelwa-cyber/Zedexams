/**
 * familyPlanBanner — what the plan strip in the family shell says, and
 * whether it says anything at all.
 *
 * Pure, so the three things that were wrong with the strip it replaces are
 * testable rather than reviewable:
 *
 *   1. It said "Pro". `Pro` (K59) and `Max` (K149) are the TEACHER tiers.
 *      A guardian is buying the learner plan, which covers the child they
 *      are linked to — so naming a teacher tier at a parent both prices the
 *      wrong product and points at a checkout that does not apply to them.
 *
 *   2. It described the GUARDIAN's own subscription. The app-level
 *      `SubscriptionStatusBanner` reads `useSubscriptionReminder`, which
 *      resolves the signed-in account's plan. A parent account is never the
 *      one being unlocked: the money credits the child (`beneficiaryUid`,
 *      see ParentPlan). So a guardian who had paid for both their children
 *      still read "You're on the free plan", because they personally were.
 *
 *   3. It had one string at every width, and at 390px the sentence
 *      truncated before the Upgrade link, leaving a banner whose only
 *      remaining control was the dismiss ✕. The short form is a separate
 *      string here rather than a CSS truncation, so the action survives.
 *
 * Nothing in this module knows a price. The rung and the figure live on
 * /family/plan, which is where the guardian decides.
 */

/** Where the banner sends a guardian who taps it. */
export const FAMILY_PLAN_ROUTE = '/family/plan'

/**
 * Should the strip render, and for whom?
 *
 * Silent in three cases, each for its own reason:
 *
 *   - still loading — a banner that appears a second late reads as a page
 *     that broke, and there is nothing to say until we know the children.
 *   - no children linked — there is nobody to unlock anything FOR. The
 *     empty state already asks for the one thing that matters first, and
 *     an upgrade offer on top of it sells before it explains.
 *   - every linked child is already covered — the guardian has paid.
 *
 * `unpaid` carries the children the offer is actually about, so the copy
 * can name a single child rather than saying "your children" to somebody
 * with one.
 */
export function resolveFamilyPlanBanner({ loading, error, children } = {}) {
  if (loading) return { show: false, reason: 'loading' }
  if (error) return { show: false, reason: 'error' }

  const list = Array.isArray(children) ? children : []
  if (list.length === 0) return { show: false, reason: 'no-children' }

  const unpaid = list.filter((c) => c?.premium !== true)
  if (unpaid.length === 0) return { show: false, reason: 'all-covered' }

  return { show: true, reason: 'offer', unpaid }
}

/** First word of a display name, for the single-child copy. */
function firstName(child) {
  const raw = String(child?.firstName || child?.displayName || '').trim()
  return raw.split(/\s+/)[0] || ''
}

/**
 * The words. `full` is the sentence; `short` is what a phone-width
 * banner shows instead — never a truncation of `full`, because the
 * truncation is what ate the action. `cta` is present in both.
 */
export function familyPlanBannerCopy(unpaid = []) {
  const list = Array.isArray(unpaid) ? unpaid : []
  const name = list.length === 1 ? firstName(list[0]) : ''

  return {
    label: 'Free plan',
    full: name ?
      `${name} is on the free plan — unlock everything for them.` :
      'Your children are on the free plan — unlock everything for them.',
    short: 'Unlock everything for your children',
    cta: 'See plans',
    to: FAMILY_PLAN_ROUTE,
  }
}
