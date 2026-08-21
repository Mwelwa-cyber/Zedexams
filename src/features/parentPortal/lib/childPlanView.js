/**
 * childPlanView — what the family app says about a child's plan.
 *
 * ── The failure this exists to close ────────────────────────────────
 *
 * A guardian paid for a day pass. The money left their account, the
 * child was unlocked, and there was no screen anywhere in /family that
 * said so — not the dashboard, not the child's card, not the child's own
 * page. The only plan copy in the whole section was the dismissible
 * amber strip in the shell, which is an OFFER: it renders when somebody
 * is unpaid and disappears the moment they are not. So the two states a
 * parent most needs to tell apart — "I have paid for this child" and "I
 * have not" — were drawn identically, as nothing.
 *
 * Two rules follow from that, and both are the reason this module is
 * separate from the banner's:
 *
 *   1. **A paid plan is stated, not implied by silence.** Every child
 *      gets a pill, always. `describeChildPlan` never returns null.
 *
 *   2. **The offer and the status are different questions.**
 *      `familyPlanBanner.js` answers "should we sell to this guardian",
 *      and is allowed to be quiet — a guardian who has decided not to
 *      buy today should not be asked again on every tab change. This
 *      answers "what is this child on", which is never quiet and is
 *      never dismissible, because dismissing a fact is how the app got
 *      into the state above.
 *
 * Pure, so the copy is testable without a DOM and the dates are testable
 * without a clock. Nothing here knows a price: the figure lives on
 * /family/plan, which is where the guardian decides.
 */

const DAY_MS = 86_400_000

/** Where a guardian goes to buy, optionally pre-aimed at one child. */
export function planRouteFor(childUid) {
  return childUid ? `/family/plan?child=${encodeURIComponent(childUid)}` : '/family/plan'
}

/** "21 Aug", or '' when there is no readable date. */
function shortDate(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/**
 * Whole days from `now` until `then`, rounded UP.
 *
 * Up rather than down, because a plan with eleven hours left has a day
 * left to the person holding it — reporting "0 days" for an account that
 * still works reads as an error, and the parent app's whole problem in
 * this area has been screens that disagree with what the child can
 * actually do.
 */
export function daysUntil(then, now) {
  // `Number(null)` is 0 and `Number('')` is 0, both finite — so a missing
  // date coerces to the epoch and resolves as "already over" rather than
  // as "we do not know". An absent value has to be refused before the
  // coercion; that mistake put an urgent red badge on plans whose end
  // date simply was not recorded.
  if (then == null || then === '' || now == null) return null
  const t = Number(then)
  const ref = Number(now)
  if (!Number.isFinite(t) || !Number.isFinite(ref)) return null
  if (t <= ref) return 0
  return Math.ceil((t - ref) / DAY_MS)
}

/** A plan inside this window is called out rather than merely stated. */
export const ENDING_SOON_DAYS = 3

/**
 * How one child's plan reads.
 *
 * @param {object} child   a row from listGuardianChildren
 * @param {number} [now]
 * @returns {{paid, tone, pill, headline, detail, cta, to, endingSoon, daysLeft}}
 *
 * `tone` is a class suffix rather than a colour, so Night mode keeps
 * working — the same rule `statusPill` follows.
 *
 * The three tones are three different asks of the reader: `idle` says
 * "here is what you could buy", `ok` says "this is paid for, nothing to
 * do", `warn` says "this is paid for and about to stop". Only the last
 * is styled to interrupt, because a plan that ends on Thursday is the
 * one fact in this module with a deadline on it.
 */
export function describeChildPlan(child, now = Date.now()) {
  const plan = child?.plan && typeof child.plan === 'object' ? child.plan : null
  // `premium` is still sent alongside `plan` and is what the shell's
  // banner reads. Falling back to it means a client that has loaded a
  // response from before `plan` existed degrades to "Premium" with no
  // date — thin, but true — rather than telling a paying guardian they
  // are on the free plan.
  const paid = plan ? plan.premium === true : child?.premium === true

  if (!paid) {
    return {
      paid: false,
      tone: 'idle',
      pill: 'Free plan',
      headline: 'On the free plan',
      detail: 'Free quizzes and the first part of every past paper.',
      cta: 'Unlock',
      to: planRouteFor(child?.childUid),
      endingSoon: false,
      daysLeft: null,
    }
  }

  const label = plan?.planLabel || 'Premium'
  // `Number(null)` is 0, which is finite — so a plan with no recorded
  // expiry would resolve to "ends today" and be styled as urgent. The
  // absent case has to be rejected before the coercion, not after it.
  const raw = plan?.expiresAt
  const expiresAt = raw == null ? null : Number(raw)
  const daysLeft = Number.isFinite(expiresAt) && expiresAt > 0 ?
    daysUntil(expiresAt, now) :
    null
  const endingSoon = daysLeft != null && daysLeft <= ENDING_SOON_DAYS
  const cascaded = plan?.source === 'guardian_cascade'

  // No expiry recorded — the shape of an account activated before the
  // dates were all written. Say the plan is on and stop there rather
  // than inventing an end date for it.
  if (daysLeft == null) {
    return {
      paid: true,
      tone: 'ok',
      pill: label,
      headline: `${label} is active`,
      detail: cascaded ?
        'Covered by your own plan.' :
        'Everything on ZedExams is unlocked.',
      cta: 'See plans',
      to: planRouteFor(child?.childUid),
      endingSoon: false,
      daysLeft: null,
    }
  }

  const on = shortDate(expiresAt)
  const remaining =
    daysLeft <= 0 ? 'Ends today' :
      daysLeft === 1 ? 'Ends tomorrow' :
        `${daysLeft} days left`

  return {
    paid: true,
    tone: endingSoon ? 'warn' : 'ok',
    // The pill names the plan, never the countdown: it sits next to a
    // child's name in a list, and "2 days left" there reads as a fact
    // about the child rather than about what was bought for them.
    pill: label,
    headline: `${label} · ${remaining}`,
    detail: cascaded ?
      `Covered by your own plan${on ? ` until ${on}` : ''}.` :
      `Paid until ${on || 'the end of the period'}.`,
    cta: endingSoon ? 'Renew' : 'See plans',
    to: planRouteFor(child?.childUid),
    endingSoon,
    daysLeft,
  }
}

/**
 * The dashboard's plan section, from the whole children list.
 *
 * Returns `{ show }` false ONLY when there is nobody to say anything
 * about — no children linked, or the list has not arrived. Everything
 * else renders, including the all-paid case: "nothing to sell here" is
 * not the same as "nothing to say here", and the all-paid case is
 * precisely the one that was invisible.
 *
 * `lead` is the sentence at the top of the section and is written for
 * the mixed case as carefully as for the simple ones, because a parent
 * with two children and one plan is exactly who is at risk of believing
 * they have paid for both.
 */
export function summariseFamilyPlan(children, now = Date.now()) {
  const list = Array.isArray(children) ? children : []
  if (list.length === 0) return { show: false, rows: [], paidCount: 0, freeCount: 0 }

  const rows = list.map((child) => ({ child, plan: describeChildPlan(child, now) }))
  const paidCount = rows.filter((r) => r.plan.paid).length
  const freeCount = rows.length - paidCount
  const endingSoon = rows.filter((r) => r.plan.endingSoon)

  let lead
  if (paidCount === 0) {
    lead = rows.length === 1 ?
      'Not unlocked yet — see what a plan covers.' :
      'None of your children are unlocked yet.'
  } else if (freeCount === 0) {
    lead = endingSoon.length > 0 ?
      'Paid for — but a plan is about to end.' :
      rows.length === 1 ? 'Paid for. Nothing else to do.' : 'All your children are covered.'
  } else {
    // Never "some of your children" — a parent has to be able to tell
    // WHICH, and the rows below say so per child.
    lead = `${paidCount} of ${rows.length} unlocked.`
  }

  return {
    show: true,
    rows,
    lead,
    paidCount,
    freeCount,
    endingSoonCount: endingSoon.length,
  }
}
