/**
 * FamilyPlanSection — "Plan and payments" on the family dashboard.
 *
 * ── What was wrong ─────────────────────────────────────────────────
 *
 * A guardian bought a day pass for their child. It went through. And
 * there was nowhere in /family that said so — not the dashboard, not the
 * child's card, not the child's page. The only plan copy in the whole
 * section was the amber strip in the shell, which is an OFFER: it shows
 * when somebody is unpaid and vanishes the moment they are not. So the
 * two states a parent most needs to tell apart were drawn identically,
 * as nothing, and the only route to the price list ran through Account →
 * Payments → Plans.
 *
 * Three properties follow, and each one is the fix to a separate half of
 * that:
 *
 *   • IT ALWAYS RENDERS when there is a child to talk about, paid or
 *     free, and it cannot be dismissed. The banner may be quiet; a
 *     statement of what somebody has paid for may not.
 *
 *   • IT NAMES EACH CHILD. A parent with two children and one plan has
 *     to be able to see WHICH — the summary line counts, and the rows
 *     say who. "Some of your children" is the sentence this exists to
 *     avoid.
 *
 *   • THE WAY TO PAY IS ON IT. One tap from the dashboard to the price
 *     list, aimed at the child the row is about, plus one tap to the
 *     receipts for what has already been paid. Neither was reachable
 *     from this screen at all.
 *
 * Everything it says comes from `childPlanView`, which is pure and
 * tested; this file only draws it.
 */
import { Link } from 'react-router-dom'
import { summariseFamilyPlan } from '../lib/childPlanView'
import { firstNameOf } from '../lib/parentAppView'
import { Avatar } from './ParentPrimitives'

/**
 * `childList`, not `children` — a prop named `children` on a React
 * component is the slot, and passing a data array into it reads as
 * content to render and trips `react/no-children-prop`.
 */
export default function FamilyPlanSection({ childList }) {
  const view = summariseFamilyPlan(childList)
  if (!view.show) return null

  return (
    <>
      <div className="lhx-section-head">
        <h2 className="lhx-section-title">Plan and payments</h2>
        <Link className="lhx-see-all" to="/family/account/billing">Receipts</Link>
      </div>

      <div className="lhx-set-group">
        <p className="pax-plan-lead">{view.lead}</p>
        {view.rows.map(({ child, plan }, i) => (
          <div className="pax-planrow" key={child.childUid}>
            <Avatar name={child.displayName} index={i} size="sm" />
            <span className="pax-planrow-main">
              <span className="pax-planrow-name">
                {firstNameOf(child.displayName) || 'Your child'}
              </span>
              <span className={`pax-planrow-head pax-planrow-head-${plan.tone}`}>
                {plan.headline}
              </span>
              <span className="pax-planrow-detail">{plan.detail}</span>
            </span>
            {/* The CTA carries the child's name in its accessible name.
                Four rows of a button reading "Unlock" is four identical
                links to a screen reader, and this one screen can hold a
                row per child. */}
            <span className="pax-planrow-cta">
              <Link
                className={`lhx-btn lhx-btn-sm ${plan.paid ? 'lhx-btn-soft' : 'lhx-btn-primary'}`}
                to={plan.to}
                aria-label={`${plan.cta} — ${firstNameOf(child.displayName) || 'your child'}`}
              >
                {plan.cta}
              </Link>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
