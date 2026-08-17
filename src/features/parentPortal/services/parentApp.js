/**
 * parentApp — client wrappers for the parent-app callables
 * (functions/parentApp/).
 *
 * Everything here is a callable rather than a Firestore read, and that is
 * not an accident of convenience. A parent may read `parentLinks` only
 * for rows that name them, so the questions this surface asks — who else
 * guards this child, which of us owns the account, which requests may I
 * act on — cannot be answered from the client without widening that rule.
 * See the header of functions/parentApp/index.js.
 *
 * The one exception is `listMyChildren` in familyPortal.js, which reads
 * the caller's own links directly; it stays there and stays used by the
 * simple linking flow.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'
import { capture } from '../../../utils/analytics'

const fns = getFunctions(app, 'us-central1')

const call = (name) => httpsCallable(fns, name)

const listGuardianChildrenCallable = call('listGuardianChildren')
const getGuardianChildDetailCallable = call('getGuardianChildDetail')
const getGuardianChildActivityCallable = call('getGuardianChildActivity')
const setChildGuardianControlCallable = call('setChildGuardianControl')
const listGuardianApprovalsCallable = call('listGuardianApprovals')
const declineGuardianApprovalCallable = call('declineGuardianApproval')
const getGuardianWeeklyReportCallable = call('getGuardianWeeklyReport')
const inviteCoGuardianCallable = call('inviteCoGuardian')
const acceptCoGuardianInviteCallable = call('acceptCoGuardianInvite')
const removeCoGuardianCallable = call('removeCoGuardian')
const resolveGuardianPayLinkCallable = call('resolveGuardianPayLink')

/** Every child linked to the signed-in guardian, with this guardian's role. */
export async function listGuardianChildren() {
  const res = await listGuardianChildrenCallable({})
  return res.data?.children || []
}

/** One child's detail: progress, controls, the week's activity, co-guardians. */
export async function getGuardianChildDetail(childUid) {
  const res = await getGuardianChildDetailCallable({ childUid })
  return res.data
}

/** The day-grouped activity timeline, over a window of up to 30 days. */
export async function getGuardianChildActivity(childUid, { days = 7 } = {}) {
  const res = await getGuardianChildActivityCallable({ childUid, days })
  return res.data
}

/**
 * Turn one of the child's permissions on or off.
 *
 * The write is server-side and audited; the caller should treat a
 * rejection as authoritative and put the switch back rather than leaving
 * an optimistic state that does not match the child's account.
 */
export async function setChildGuardianControl(childUid, key, value) {
  const res = await setChildGuardianControlCallable({ childUid, key, value })
  capture('guardian_control_set', { key, value: value ? 'on' : 'off', via: 'parent_app' })
  return res.data
}

/** Pending requests across every linked child, newest first. */
export async function listGuardianApprovals() {
  const res = await listGuardianApprovalsCallable({})
  return res.data?.approvals || []
}

/**
 * Decline a request. There is no `approve` twin on purpose — approving a
 * premium unlock means paying for it, so the approve path routes to
 * checkout and the request is settled by the payment webhook.
 */
export async function declineGuardianApproval(requestId) {
  const res = await declineGuardianApprovalCallable({ requestId })
  capture('guardian_request_declined', {})
  return res.data
}

/** This week's report for one child. */
export async function getGuardianWeeklyReport(childUid) {
  const res = await getGuardianWeeklyReportCallable({ childUid })
  return res.data
}

/** Owner invites a co-guardian by email. */
export async function inviteCoGuardian(childUid, email) {
  const res = await inviteCoGuardianCallable({ childUid, email })
  capture('co_guardian_invited', {})
  return res.data
}

/** The invitee accepts, from the link in their email. */
export async function acceptCoGuardianInvite(token) {
  const res = await acceptCoGuardianInviteCallable({ token })
  capture('co_guardian_accepted', {})
  return res.data
}

/**
 * Resolve the token in a guardian's pay link. Callable without being
 * signed in — the guardian holding that email may have no account yet,
 * and the page has to say what the request is before it can ask them to
 * make one.
 */
export async function resolveGuardianPayLink(token) {
  const res = await resolveGuardianPayLinkCallable({ token })
  return res.data
}

/** Owner removes a co-guardian, or revokes an invite that is still pending. */
export async function removeCoGuardian({ childUid, parentUid, inviteId }) {
  const res = await removeCoGuardianCallable({ childUid, parentUid, inviteId })
  return res.data
}
