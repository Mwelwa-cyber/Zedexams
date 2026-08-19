/**
 * DeletionPendingBanner — the standing reminder that a deletion is running.
 *
 * ── Why this exists at all ─────────────────────────────────────────────
 *
 * A `scheduled` account is a LIVE account with a clock on it. Everything works,
 * the streak keeps its place, the notes are all there — and in thirty days none
 * of it will be. A child (or an adult) who has to remember to go and look in
 * Settings to discover that is a child who finds out on day thirty-one.
 *
 * So the banner is not a nicety, it is the mechanism that makes the grace
 * window real: a window nobody can see is indistinguishable from an immediate
 * deletion with a delay on it.
 *
 * ── It renders in three states, not one ────────────────────────────────
 *
 * `pending_guardian` and `escalated_support` get a banner too, and they need
 * different words. "We are waiting on your grown-up" is information; a
 * countdown would be a lie, because nothing is scheduled until somebody says
 * yes. A single banner reading "your account is being deleted" across all three
 * would be wrong in two of them.
 *
 * ── Why it lives in learnerHome and not in learnerSettings ─────────────
 *
 * It is about deletion, which is a settings concern — but its JOB is shell
 * chrome, and `learnerHome` owns `LearnerShell`. Putting it beside the delete
 * screen would mean the shell reaching across a feature boundary
 * (`test:import-boundaries` refuses that), and the alternative — exporting it
 * from the settings front door — would hang a Firebase-functions edge off a
 * door that every settings consumer opens. It lives with its only consumer.
 *
 * ── Where the numbers come from ────────────────────────────────────────
 *
 * The server. `getDeletionRequest` returns the banner shape already computed by
 * `deletionRequestCore.pendingBanner`, so the number of days left on screen is
 * the number the executor will act on. A countdown computed in the browser
 * against a device clock is a countdown that disagrees with the server on any
 * phone whose date is wrong — which, on a shared or second-hand handset, is a
 * lot of them.
 */

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import {
  DELETION_STATE,
  cancelDeletionRequest,
  getDeletionRequest,
} from '../../../services/accountDeletion/deletionRequestService'

const COPY = {
  [DELETION_STATE.SCHEDULED]: (b) => ({
    icon: '⏳',
    title: b.daysLeft === 0
      ? 'Your account is deleted today'
      : `Your account is deleted in ${b.daysLeft} ${b.daysLeft === 1 ? 'day' : 'days'}`,
    sub: 'Everything is paused, not gone. One tap brings it back.',
    action: 'Keep it',
  }),
  [DELETION_STATE.PENDING_GUARDIAN]: (b) => ({
    icon: '✉️',
    title: 'We asked your grown-up',
    sub: b.daysLeft != null
      ? `Nothing has been deleted. ${b.daysLeft} ${b.daysLeft === 1 ? 'day' : 'days'} until our team steps in.`
      : 'Nothing has been deleted while we wait for them.',
    action: 'Cancel',
  }),
  [DELETION_STATE.ESCALATED_SUPPORT]: () => ({
    icon: '🧑‍💼',
    title: 'Our team is handling your request',
    sub: 'Nothing has been deleted. You do not need to do anything.',
    action: 'Cancel',
  }),
}

export default function DeletionPendingBanner() {
  const { currentUser, userProfile } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)

  // The gate, and the reason this component is cheap enough to mount in the
  // shell: `deletionRequestState` is a server-written mirror already in the
  // profile we hold, so a learner with no open request costs ZERO calls. Only
  // an account that actually has one pays for the details.
  //
  // The mirror is on the users self-update blocklist in both directions — a
  // learner who could set it would put a "your account is being deleted"
  // banner on any profile they could write, and the field is only a mirror, so
  // the banner would be a lie the server never told.
  const mirrored = userProfile?.deletionRequestState || null

  const load = useCallback(async () => {
    if (!currentUser?.uid || !mirrored) { setState(null); return }
    try {
      const res = await getDeletionRequest()
      setState(res?.request && res?.banner ? { request: res.request, banner: res.banner } : null)
    } catch {
      // A failed read renders NOTHING rather than a guessed banner. Claiming a
      // deletion that is not running would be worse than missing one that is,
      // and the child reaches the real state from Settings either way.
      setState(null)
    }
  }, [currentUser?.uid, mirrored])

  useEffect(() => { load() }, [load])

  if (!state) return null

  const build = COPY[state.request.state]
  if (!build) return null
  const copy = build(state.banner)

  const keep = async () => {
    if (busy) return
    setBusy(true)
    try {
      await cancelDeletionRequest(state.request.id)
      setState(null)
    } catch {
      // Send them to the screen that can explain, rather than failing silently
      // on the one control standing between them and losing everything.
      navigate('/settings/delete')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lhx-del-banner" role="status">
      <span className="lhx-del-banner-ic" aria-hidden="true">{copy.icon}</span>
      <span className="lhx-del-banner-txt">
        <span className="lhx-del-banner-title">{copy.title}</span>
        <span className="lhx-del-banner-sub">{copy.sub}</span>
      </span>
      <button
        type="button"
        className="lhx-del-banner-btn"
        onClick={keep}
        disabled={busy}
      >
        {busy ? '…' : copy.action}
      </button>
    </div>
  )
}
