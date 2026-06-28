/**
 * Admin actions for the Central Question Bank review queue (/admin/question-review).
 *
 * These writes flip the server-owned review fields (reviewStatus, masterEligible,
 * duplicateOf). firestore.rules allow them because the caller is an admin
 * (isAdmin() update branch). Teachers can never reach these.
 */

import {
  collection, query, where, limit, getDocs, doc, getDoc, updateDoc,
  serverTimestamp, increment,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { parseBankQuestion, bumpQuestionUsage } from './questionBankService'
import { bankPreview } from './questionBankCore.js'

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

/** Confirm a duplicate: link to the original and bump its usage count. */
export async function mergeWithExisting(id, targetId, adminUid) {
  if (!targetId) throw new Error('Pick the original question to merge into.')
  await updateDoc(doc(db, 'questionBank', id), {
    reviewStatus: 'duplicate',
    masterEligible: false,
    duplicateOf: targetId,
    reviewedBy: adminUid || null,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await updateDoc(doc(db, 'questionBank', targetId), {
    usageCount: increment(1),
    updatedAt: serverTimestamp(),
  }).catch(() => bumpQuestionUsage(targetId))
}
