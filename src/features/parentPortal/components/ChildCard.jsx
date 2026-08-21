/**
 * ChildCard — one child in the overview list.
 *
 * The meta line carries only figures ZedExams actually holds: the grade,
 * how many guardians the child has, and when they were last on. The
 * prototype also shows a completion bar and "3h 20m this week"; the bar
 * is real (subject completion) and is rendered on the child's own
 * screen where it can be broken down, and the time is not measured at
 * all, so it does not appear. See functions/parentApp/parentAppCore.js.
 *
 * The PLAN is the one thing here that is not a progress figure and is
 * drawn anyway. It was missing entirely: a child a guardian had paid for
 * and a child they had not looked identical on this card, which is how a
 * bought day pass ended up with no screen in the whole family app that
 * acknowledged it. It sits on its own line under the meta rather than
 * inside it, because the meta line is already at its width on a 360px
 * phone and the plan is the half a parent is looking for.
 */
import { useNavigate } from 'react-router-dom'
import { Avatar, PlanPill, StatusPill } from './ParentPrimitives'
import { firstNameOf } from '../lib/parentAppView'
import { describeChildPlan } from '../lib/childPlanView'

function lastSeen(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'not started yet'
  const days = Math.floor((Date.now() - ms) / 86_400_000)
  if (days <= 0) return 'on today'
  if (days === 1) return 'on yesterday'
  if (days < 7) return `last on ${days} days ago`
  if (days < 14) return 'last on over a week ago'
  return 'last on a while ago'
}

export default function ChildCard({ child, index = 0 }) {
  const navigate = useNavigate()
  const name = firstNameOf(child.displayName) || 'Your child'
  const plan = describeChildPlan(child)

  const meta = [
    child.grade ? `Grade ${child.grade}` : null,
    lastSeen(child.lastActiveAt),
    child.guardianCount > 1 ? `${child.guardianCount} guardians` : null,
  ].filter(Boolean).join(' · ')

  return (
    <button
      type="button"
      className="pax-kid"
      onClick={() => navigate(`/family/child/${child.childUid}`)}
    >
      <Avatar name={child.displayName} index={index} size="md" />
      <span className="pax-kid-main">
        <span className="pax-kid-name">{name}</span>
        <span className="pax-kid-meta">{meta}</span>
        <span className="pax-kid-tags">
          <PlanPill plan={plan} />
        </span>
      </span>
      <StatusPill status={child.status} />
    </button>
  )
}
