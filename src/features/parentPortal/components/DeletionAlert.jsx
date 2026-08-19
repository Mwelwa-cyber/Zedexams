/**
 * DeletionAlert — the red card on /family when a child has asked to leave.
 *
 * It lands in the SAME PLACE as the amber "Needs your approval" feed, so there
 * is one habit to learn: a guardian who has answered a Premium request knows
 * where to look. But it is styled as a red alert rather than an amber nudge,
 * and that is the one thing about this component worth defending.
 *
 * A Premium unlock request waits indefinitely and asks for money. This one has
 * a clock on it — seven days, after which the child is escalated to support —
 * and what it asks for cannot be taken back after thirty. Two requests that
 * look identical train a parent to treat them identically, and the one that
 * matters is the one they would then skim.
 *
 * ── It shows the days remaining, not the days elapsed ──────────────────
 *
 * "Asked 2 days ago" is a fact about the past. "5 days to reply" is the thing
 * a parent has to act on, and it is what turns the card from a notification
 * into a task.
 *
 * ── It does not offer a decision here ──────────────────────────────────
 *
 * No Approve, no Decline, not even inline. The decision needs the child's
 * streak, their exam countdown, the two lists and the plan panel to be an
 * informed one — so this card's only job is to get the guardian to the screen
 * that has them. A one-tap Approve on a home-screen card would be the same
 * mistake as a one-tap purchase.
 */

import { Link } from 'react-router-dom'
import { Avatar } from './ParentPrimitives'

/** Seven days from the ask, matching GUARDIAN_RESPONSE_DAYS on the server. */
const RESPONSE_DAYS = 7

function daysLeft(requestedAt) {
  if (!requestedAt) return null
  const elapsed = Date.now() - requestedAt
  const left = Math.ceil((RESPONSE_DAYS * 24 * 60 * 60 * 1000 - elapsed) / (24 * 60 * 60 * 1000))
  return left > 0 ? left : 0
}

export default function DeletionAlert({ requests }) {
  if (!requests || requests.length === 0) return null

  return (
    <section className="pax-alert-card" aria-labelledby="pax-deletions">
      <h2 className="pax-alert-head" id="pax-deletions">
        ⚠️ Needs your answer
      </h2>
      {requests.map((req, i) => {
        const name = (req.childName || 'Your child').split(/\s+/)[0]
        const left = daysLeft(req.requestedAt)
        return (
          <Link className="pax-alert-row" to={`/family/requests/${req.id}`} key={req.id}>
            <Avatar name={req.childName} index={i} size="sm" />
            <span className="pax-req-text">
              <b>{name} wants to delete their account</b>
              <small>
                {left === null
                  ? 'Tap to review'
                  : left === 0
                    ? 'Last day to reply'
                    : `${left} ${left === 1 ? 'day' : 'days'} to reply`}
                {req.parkedAt ? ' · you parked this' : ''}
              </small>
            </span>
            <span className="pax-alert-chev" aria-hidden="true">›</span>
          </Link>
        )
      })}
    </section>
  )
}
