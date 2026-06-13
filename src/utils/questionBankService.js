/**
 * Teacher Question Bank — save individual questions and reuse them in any
 * future paper. Owner-scoped: every doc carries `ownerId` and firestore.rules
 * only ever lets a teacher read/write their own.
 *
 * Storage shape (questionBank/{autoId}):
 *   ownerId   — uid of the owning teacher
 *   data      — the full question object as a JSON string (sidesteps
 *               Firestore's no-nested-arrays limit: tables, matching, etc.)
 *   type/subject/grade/topic/marks — denormalised for filtering + display
 *   preview   — plain-text stem snippet for list rows
 *   createdAt — serverTimestamp
 */

import {
  collection, addDoc, getDocs, deleteDoc, doc, query, where, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { bankPreview, sanitizeQuestionForBank, bankRowMatches, byNewest } from './questionBankCore.js'

const FETCH_LIMIT = 300

/** Save a question into the signed-in teacher's bank. Returns the new doc id. */
export async function saveQuestionToBank(uid, question, meta = {}) {
  if (!uid) throw new Error('Sign in to save questions.')
  if (!question) throw new Error('No question to save.')
  const clean = sanitizeQuestionForBank(question)
  const ref = await addDoc(collection(db, 'questionBank'), {
    ownerId: uid,
    data: JSON.stringify(clean),
    type: String(question.type || 'mcq'),
    subject: String(meta.subject || ''),
    grade: String(meta.grade || ''),
    topic: String(meta.topic || question.topic || ''),
    preview: bankPreview(question),
    marks: Number(question.marks) || 1,
    createdAt: serverTimestamp(),
  })
  return ref.id
}

/**
 * Search the teacher's bank. We deliberately avoid a Firestore orderBy (which
 * would need a composite index alongside the ownerId filter) and sort/filter
 * the bounded result set on the client instead.
 * Returns { rows, error } so the picker can tell "empty" from "failed".
 */
export async function searchMyBankQuestions(uid, { term = '', type = '', subject = '' } = {}) {
  if (!uid) return { rows: [], error: null }
  try {
    const snap = await getDocs(query(
      collection(db, 'questionBank'),
      where('ownerId', '==', uid),
      limit(FETCH_LIMIT),
    ))
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (type) rows = rows.filter(r => r.type === type)
    if (subject) rows = rows.filter(r => !r.subject || r.subject === subject)
    rows = rows.filter(r => bankRowMatches(r, term)).sort(byNewest)
    return { rows, error: null }
  } catch (err) {
    console.error('searchMyBankQuestions failed', err)
    return { rows: [], error: err?.message || 'Could not load your question bank.' }
  }
}

/** Parse a stored row's JSON back into a question object (null on corruption). */
export function parseBankQuestion(row) {
  try {
    return JSON.parse(row?.data || 'null')
  } catch {
    return null
  }
}

/** Delete a saved question. Best-effort. */
export async function deleteBankQuestion(id) {
  if (!id) return
  try {
    await deleteDoc(doc(db, 'questionBank', id))
  } catch (err) {
    console.error('deleteBankQuestion failed', err)
  }
}
