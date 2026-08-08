/**
 * Admin actions for the Central Question Bank review queue (/admin/question-review).
 *
 * These writes flip the server-owned review fields (reviewStatus, masterEligible,
 * duplicateOf). firestore.rules allow them because the caller is an admin
 * (isAdmin() update branch). Teachers can never reach these.
 */

import {
  collection, query, where, limit, getDocs, doc, getDoc, updateDoc,
  serverTimestamp, increment, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { parseBankQuestion, bumpQuestionUsage } from './questionBankService'
import { bankPreview, REVIEW_STATUS } from './questionBankCore.js'

const QUEUE_LIMIT = 200

/**
 * Load the review queue: questions the AI sent to a human (needs_admin) plus
 * detected duplicates (which an admin can confirm-merge or override). Sorted
 * newest-first client-side to avoid a composite index.
 */
export async function loadReviewQueue() {
  try {
    const snap = await getDocs(query(
      collection(db, 'questionBank'),
      where('reviewStatus', 'in', ['needs_admin', 'duplicate']),
      limit(QUEUE_LIMIT),
    ))
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    rows.sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0))
    return { rows, error: null }
  } catch (err) {
    console.error('loadReviewQueue failed', err)
    return { rows: [], error: err?.message || 'Could not load the review queue.' }
  }
}

/** Approve a question into the Master Bank. */
export async function approveQuestion(id, adminUid) {
  await updateDoc(doc(db, 'questionBank', id), {
    reviewStatus: 'approved',
    masterEligible: true,
    duplicateOf: null,
    similarity: null,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Edit the question's marking guide / answer text + marks inline, then approve.
 * Writes the edited fields back into the stored JSON `data` and refreshes the
 * denormalised preview/marks, bumping the version.
 */
export async function editAndApproveQuestion(id, edits, adminUid) {
  const snap = await getDoc(doc(db, 'questionBank', id))
  if (!snap.exists()) throw new Error('Question no longer exists.')
  const row = { id: snap.id, ...snap.data() }
  const question = parseBankQuestion(row) || {}
  if (typeof edits.text === 'string') question.text = edits.text
  if (typeof edits.explanation === 'string') question.explanation = edits.explanation
  if (edits.marks != null && Number.isFinite(Number(edits.marks))) question.marks = Number(edits.marks)
  await updateDoc(doc(db, 'questionBank', id), {
    data: JSON.stringify(question),
    preview: bankPreview(question),
    marks: Number(question.marks) || row.marks || 1,
    version: (Number(row.version) || 1) + 1,
    reviewStatus: 'approved',
    masterEligible: true,
    duplicateOf: null,
    similarity: null,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/** Reject a question — never reaches the Master Bank. */
export async function rejectQuestion(id, adminUid, reason = '') {
  await updateDoc(doc(db, 'questionBank', id), {
    reviewStatus: 'rejected',
    masterEligible: false,
    reviewNotes: reason || null,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/** Archive a question (out of circulation, recoverable). */
export async function archiveQuestion(id, adminUid) {
  await updateDoc(doc(db, 'questionBank', id), {
    reviewStatus: 'archived',
    masterEligible: false,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/** Keep the question in the owner's private bank only — not shared. */
export async function keepPrivateQuestion(id, adminUid) {
  await updateDoc(doc(db, 'questionBank', id), {
    reviewStatus: 'private_saved',
    masterEligible: false,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

// Statuses that mean "captured but not yet in the Master Bank" — these are the
// ones a bulk-approve sweeps into the bank. (We deliberately skip rejected /
// archived / private_saved / merged / already-approved.)
//
// 'duplicate' is deliberately NOT here: those are copies Qix flagged that are
// still waiting on a human verdict, so sweeping them in would push confirmed
// duplicates straight into the shared Master Bank.
const APPROVABLE_STATUSES = ['pending_review', 'needs_admin']

/**
 * Approve every still-pending question owned by this admin into the Master Bank
 * in one sweep. This is the "the AI reviewer left my import waiting — push them
 * live now" button: after the one-click import, the captured rows sit at
 * `pending_review` until Qix (or an admin) approves them, so until then the
 * teacher bank shows "0 from the Master Bank". This flips them in batches.
 *
 * Scoped to `ownerId == adminUid` so it only touches the admin's own captures
 * (e.g. the import backfill), never another teacher's private pending questions.
 * Returns { approved, error }. Calls onProgress({ approved }) as it goes.
 */
export async function bulkApproveOwnedPending(adminUid, onProgress) {
  if (!adminUid) return { approved: 0, error: 'Missing admin id.' }
  try {
    const snap = await getDocs(query(
      collection(db, 'questionBank'),
      where('ownerId', '==', adminUid),
    ))
    const pending = snap.docs.filter(d => APPROVABLE_STATUSES.includes(d.data()?.reviewStatus))
    let approved = 0
    // Firestore writeBatch caps at 500 ops; chunk well under that.
    const CHUNK = 400
    for (let i = 0; i < pending.length; i += CHUNK) {
      const batch = writeBatch(db)
      for (const d of pending.slice(i, i + CHUNK)) {
        batch.update(d.ref, {
          reviewStatus: 'approved',
          masterEligible: true,
          duplicateOf: null,
          similarity: null,
          reviewedBy: adminUid,
          reviewedAt: serverTimestamp(),
          reviewNotes: 'Bulk-approved by admin',
          updatedAt: serverTimestamp(),
        })
      }
      await batch.commit()
      approved += Math.min(CHUNK, pending.length - i)
      onProgress?.({ approved })
    }
    return { approved, error: null }
  } catch (err) {
    console.error('bulkApproveOwnedPending failed', err)
    return { approved: 0, error: err?.message || 'Bulk approve failed.' }
  }
}

/**
 * Confirm a duplicate: link it to the original and bump the original's usage.
 *
 * This has to land on a *terminal* status. It previously wrote back
 * `reviewStatus: 'duplicate'` — the very status loadReviewQueue() filters on —
 * so a merged row never actually left the queue. Because the write also
 * refreshes `updatedAt`, and the queue sorts newest-first, merged rows floated
 * back to the TOP on the next load and looked like fresh work. The card
 * disappearing was purely optimistic client-side state.
 */
export async function mergeWithExisting(id, targetId, adminUid) {
  if (!targetId) throw new Error('Pick the original question to merge into.')
  if (id === targetId) throw new Error('A question cannot be merged into itself.')

  const ref = doc(db, 'questionBank', id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('Question no longer exists.')

  // Don't double-count the original. If this row was already confirmed against
  // the same target (e.g. re-merging rows that bounced back because of the bug
  // above), re-stamp the status but skip the usageCount increment.
  const prev = snap.data() || {}
  const alreadyCounted = Boolean(prev.reviewedAt) && prev.duplicateOf === targetId

  await updateDoc(ref, {
    reviewStatus: REVIEW_STATUS.MERGED,
    masterEligible: false,
    duplicateOf: targetId,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  if (alreadyCounted) return

  await updateDoc(doc(db, 'questionBank', targetId), {
    usageCount: increment(1),
    updatedAt: serverTimestamp(),
  }).catch(() => bumpQuestionUsage(targetId))
}
