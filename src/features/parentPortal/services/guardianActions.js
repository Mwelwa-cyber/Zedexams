/**
 * guardianActions — client side of the two things a guardian can still do
 * after the parent app closed: answer a child's account-deletion request, and
 * withdraw their own consent.
 *
 * Nothing here is new server surface. Both go through callables that already
 * authorise by the signed-in uid (`respondToDeletionRequest` checks the caller
 * is the guardian NAMED on the request; `withdrawGuardianConsent` acts only on
 * the caller's own link), and the link list is a Firestore read the existing
 * `parentLinks` rule allows for exactly this: `parentUid == request.auth.uid`.
 *
 * The deletion calls are re-exported from the shared service rather than
 * wrapped again, so the guardian screen and the child's screen cannot disagree
 * about the payloads.
 */
import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'

export {
  getDeletionRequest,
  respondToDeletionRequest,
  cancelDeletionRequest,
} from '../../../services/accountDeletion/deletionRequestService'

// Resolved at call time, like the deletion service: constructing the
// Functions client at import would run during a lazy chunk load.
let cachedFns = null
function callable(name) {
  if (!cachedFns) cachedFns = getFunctions(app, 'us-central1')
  return httpsCallable(cachedFns, name)
}

/**
 * The links this guardian holds, newest first by name — the rule lets a
 * parent read exactly their own, so the `where` is required, not decoration.
 *
 * @returns {Promise<Array<{id: string, childUid: string, childName: string,
 *   grade: (string|number|null), raw: object}>>}
 */
export async function listMyLinks(parentUid) {
  if (!parentUid) return []
  const snap = await getDocs(query(collection(db, 'parentLinks'), where('parentUid', '==', parentUid)))
  return snap.docs
    .map((d) => {
      const data = d.data() || {}
      return {
        id: d.id,
        childUid: data.learnerUid || '',
        childName: data.learnerDisplayName || '',
        grade: data.learnerGrade ?? null,
        raw: data,
      }
    })
    .filter((l) => l.childUid)
    .sort((a, b) => a.childName.localeCompare(b.childName))
}

/** End this guardian's own consent for one child. */
export async function withdrawGuardianConsent(childUid) {
  const res = await callable('withdrawGuardianConsent')({ childUid })
  return res?.data || null
}
