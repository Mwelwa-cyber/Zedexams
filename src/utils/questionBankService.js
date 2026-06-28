/**
 * Central Question Bank — the platform's question knowledge engine.
 *
 * Every question a teacher creates (manually, by AI, by import, by scan) is
 * captured here automatically. Each doc is owner-scoped and carries a review
 * lifecycle; the cross-teacher "Master Bank" is simply the subset with
 * masterEligible === true (set by the Qix review agent on approval).
 *
 * Storage shape (questionBank/{autoId}):
 *   ownerId        — uid of the owning teacher
 *   data           — the full question object as a JSON string (sidesteps
 *                    Firestore's no-nested-arrays limit: tables, matching, etc.)
 *   type/subject/grade/topic/subtopic/curriculum/difficulty/marks
 *                  — denormalised for filtering + display
 *   preview        — plain-text stem snippet for list rows
 *   hasDiagram     — denormalised so "with/without diagram" filters need no parse
 *   keywords       — lowercased tokens for keyword search
 *   fingerprint    — exact-duplicate hash (questionBankCore.questionFingerprint)
 *   simhashTokens  — near-duplicate token set (questionBankCore.questionTokens)
 *   source         — where the question came from (see QUESTION_SOURCES)
 *   reviewStatus   — pending_review | approved | needs_admin | duplicate | rejected | private_saved | archived
 *   masterEligible — true only when approved; the Master Bank filter
 *   usageCount     — incremented when reused in a paper
 *   version        — bumped on edit
 *   createdAt / updatedAt — serverTimestamps
 *
 * Server-owned fields (the Qix Cloud Function writes these; firestore.rules
 * keeps clients from forging them): reviewStatus transitions, masterEligible,
 * aiReview, duplicateOf, similarity.
 */

import {
  collection, addDoc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, deleteField, doc, query, where,
  limit, serverTimestamp, increment, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  bankPreview, sanitizeQuestionForBank, bankRowMatches, byNewest,
  questionFingerprint, questionTokens, extractKeywords,
  REVIEW_STATUS, QUESTION_SOURCES,
} from './questionBankCore.js'

const FETCH_LIMIT = 300

/** Does this question carry an image / library diagram? (denormalised filter) */
function questionHasDiagram(question) {
  return Boolean(
    question?.imageUrl ||
    question?.imageDiagram ||
    (Array.isArray(question?.diagramLabels) && question.diagramLabels.length) ||
    (Array.isArray(question?.optionMedia) && question.optionMedia.some(m => m?.imageUrl || m?.diagram)),
  )
}

/**
 * Build the Firestore row for a question. Shared by the manual save path and
 * the automatic capture path so both store identical, search-ready shapes.
 *
 * `reviewState` overrides the default review lifecycle. It's left null for the
 * normal capture path (questions enter as pending_review and Qix reviews them),
 * and set to the approved/Master state only by the admin curation backfill,
 * which seeds already-vetted platform content straight into the shared Master
 * Bank. firestore.rules only permit a master-eligible create for admins.
 */
function buildBankRow(uid, question, meta = {}, source = 'manual', reviewState = null) {
  const clean = sanitizeQuestionForBank(question)
  return {
    ownerId: uid,
    data: JSON.stringify(clean),
    type: String(question.type || 'mcq'),
    subject: String(meta.subject || ''),
    grade: String(meta.grade || ''),
    topic: String(meta.topic || question.topic || ''),
    subtopic: String(meta.subtopic || question.subtopic || ''),
    curriculum: String(meta.curriculum || 'CBC'),
    difficulty: String(question.difficulty || meta.difficulty || ''),
    marks: Number(question.marks) || 1,
    preview: bankPreview(question),
    hasDiagram: questionHasDiagram(question),
    keywords: extractKeywords(question, meta),
    fingerprint: questionFingerprint(question),
    simhashTokens: questionTokens(question),
    source: QUESTION_SOURCES.includes(source) ? source : 'manual',
    reviewStatus: reviewState?.reviewStatus || REVIEW_STATUS.PENDING_REVIEW,
    masterEligible: reviewState?.masterEligible === true,
    usageCount: 0,
    version: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

/**
 * Save a single question into the signed-in teacher's bank (manual "Save to
 * bank" action). Returns the new doc id. Enters the review pipeline like any
 * captured question.
 */
export async function saveQuestionToBank(uid, question, meta = {}, source = 'manual') {
  if (!uid) throw new Error('Sign in to save questions.')
  if (!question) throw new Error('No question to save.')
  const ref = await addDoc(collection(db, 'questionBank'), buildBankRow(uid, question, meta, source))
  return ref.id
}

/**
 * Automatically capture a batch of questions into the teacher's bank. This is
 * the heart of the "no Share button" flow — call it fire-and-forget after a
 * quiz/assessment write succeeds. Best-effort and idempotent-ish: it never
 * throws into the caller (failures are swallowed + logged) so capture can
 * never break the surface that produced the questions.
 *
 * Returns { saved, skipped } counts. Skips empty/blank stems.
 *
 * `opts.reviewState` (admin curation only) seeds the rows directly as
 * approved/Master-eligible instead of the default pending_review.
 */
export async function captureQuestionsToBank(uid, questions, meta = {}, source = 'manual', opts = {}) {
  if (!uid || !Array.isArray(questions) || !questions.length) return { saved: 0, skipped: 0 }
  const reviewState = opts?.reviewState || null
  let saved = 0
  let skipped = 0
  try {
    // Firestore batches cap at 500 writes; questions per paper are far fewer,
    // but chunk defensively so an unusually large import still lands.
    const usable = questions.filter(q => q && bankPreview(q))
    skipped = questions.length - usable.length
    for (let i = 0; i < usable.length; i += 400) {
      const slice = usable.slice(i, i + 400)
      const batch = writeBatch(db)
      for (const q of slice) {
        batch.set(doc(collection(db, 'questionBank')), buildBankRow(uid, q, meta, source, reviewState))
      }
      await batch.commit()
      saved += slice.length
    }
  } catch (err) {
    // Capture must never surface to the teacher — log and move on.
    console.error('captureQuestionsToBank failed', err)
  }
  return { saved, skipped }
}

/**
 * Search the teacher's own bank. Avoids a Firestore orderBy (which would need
 * a composite index alongside the ownerId filter) and sorts/filters the
 * bounded result set on the client. Returns { rows, error }.
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

/** Apply the rich client-side filter set used by the teacher browser. */
function applyBankFilters(rows, f = {}) {
  let out = rows
  if (f.type) out = out.filter(r => r.type === f.type)
  if (f.subject) out = out.filter(r => r.subject === f.subject)
  if (f.grade) out = out.filter(r => String(r.grade) === String(f.grade))
  if (f.topic) out = out.filter(r => (r.topic || '').toLowerCase().includes(f.topic.toLowerCase()))
  if (f.subtopic) out = out.filter(r => (r.subtopic || '').toLowerCase().includes(f.subtopic.toLowerCase()))
  if (f.curriculum) out = out.filter(r => r.curriculum === f.curriculum)
  if (f.difficulty) out = out.filter(r => r.difficulty === f.difficulty)
  if (f.source) out = out.filter(r => r.source === f.source)
  if (f.marks) out = out.filter(r => Number(r.marks) === Number(f.marks))
  if (f.withDiagram === true) out = out.filter(r => r.hasDiagram)
  if (f.withDiagram === false) out = out.filter(r => !r.hasDiagram)
  if (f.term) out = out.filter(r => bankRowMatches(r, f.term))
  return out
}

/**
 * Unified search across the teacher's own bank PLUS the cross-teacher Master
 * Bank (masterEligible === true). De-duplicates by doc id (a teacher's own
 * approved question appears in both queries). `scope` can be 'all' | 'mine' |
 * 'master'. `sort` can be 'newest' | 'mostUsed'.
 */
export async function searchQuestionBank(uid, { scope = 'all', sort = 'newest', ...filters } = {}) {
  try {
    const queries = []
    if (uid && scope !== 'master') {
      queries.push(getDocs(query(
        collection(db, 'questionBank'),
        where('ownerId', '==', uid),
        limit(FETCH_LIMIT),
      )))
    }
    if (scope !== 'mine') {
      queries.push(getDocs(query(
        collection(db, 'questionBank'),
        where('masterEligible', '==', true),
        limit(FETCH_LIMIT),
      )))
    }
    const snaps = await Promise.all(queries)
    const byId = new Map()
    for (const snap of snaps) {
      for (const d of snap.docs) {
        if (!byId.has(d.id)) byId.set(d.id, { id: d.id, ...d.data() })
      }
    }
    const rows = applyBankFilters([...byId.values()], filters)
    rows.sort(sort === 'mostUsed'
      ? (a, b) => (Number(b.usageCount) || 0) - (Number(a.usageCount) || 0)
      : byNewest)
    return { rows, error: null }
  } catch (err) {
    console.error('searchQuestionBank failed', err)
    return { rows: [], error: err?.message || 'Could not load the question bank.' }
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

/** Record that a banked question was reused in a paper (best-effort). */
export async function bumpQuestionUsage(id) {
  if (!id) return
  try {
    await updateDoc(doc(db, 'questionBank', id), {
      usageCount: increment(1),
      updatedAt: serverTimestamp(),
    })
  } catch (err) {
    console.error('bumpQuestionUsage failed', err)
  }
}

/** Duplicate a banked question into the signed-in teacher's bank (re-enters review). */
export async function duplicateBankQuestion(uid, row, meta = {}) {
  const question = parseBankQuestion(row)
  if (!question) throw new Error('Could not read that question.')
  return saveQuestionToBank(uid, question, {
    subject: row.subject, grade: row.grade, topic: row.topic,
    subtopic: row.subtopic, curriculum: row.curriculum, ...meta,
  }, 'manual')
}

/**
 * Edit one of the signed-in teacher's own banked questions. Updates the stem /
 * marking guide / marks and re-enters review (clears the old verdict so Qix
 * re-scores it). firestore.rules permit this only for the owner and only back
 * to pending_review (never self-approve).
 */
export async function editMyBankQuestion(id, edits, row) {
  if (!id) throw new Error('Missing question id.')
  const question = parseBankQuestion(row) || {}
  if (typeof edits.text === 'string') question.text = edits.text
  if (typeof edits.explanation === 'string') question.explanation = edits.explanation
  if (edits.marks != null && Number.isFinite(Number(edits.marks))) question.marks = Number(edits.marks)
  await updateDoc(doc(db, 'questionBank', id), {
    data: JSON.stringify(question),
    preview: bankPreview(question),
    marks: Number(question.marks) || row?.marks || 1,
    fingerprint: questionFingerprint(question),
    simhashTokens: questionTokens(question),
    keywords: extractKeywords(question, row || {}),
    version: (Number(row?.version) || 1) + 1,
    reviewStatus: REVIEW_STATUS.PENDING_REVIEW,
    masterEligible: false,
    duplicateOf: null,
    similarity: null,
    aiReview: deleteField(),
    updatedAt: serverTimestamp(),
  })
}

/**
 * Promote a batch of already-banked questions straight into the shared Master
 * Bank (admin curation only — firestore.rules gate this to admins via the
 * isAdmin() update branch). Used by the import backfill to surface rows that an
 * earlier run captured as pending_review. Chunked into Firestore batch limits.
 * Returns the number of rows promoted.
 */
export async function promoteQuestionsToMaster(ids = []) {
  const clean = [...new Set((ids || []).filter(Boolean))]
  let promoted = 0
  for (let i = 0; i < clean.length; i += 400) {
    const slice = clean.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const id of slice) {
      batch.update(doc(db, 'questionBank', id), {
        reviewStatus: REVIEW_STATUS.APPROVED,
        masterEligible: true,
        duplicateOf: null,
        similarity: null,
        updatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
    promoted += slice.length
  }
  return promoted
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

/* --- Favourites: questionBankFavourites/{uid}/items/{questionId} --- */

/** Star or unstar a question for the signed-in teacher. Returns the new state. */
export async function toggleFavouriteQuestion(uid, questionId, on, snapshotMeta = {}) {
  if (!uid || !questionId) return Boolean(on)
  const ref = doc(db, 'questionBankFavourites', uid, 'items', questionId)
  try {
    if (on) {
      await setDoc(ref, { questionId, ...snapshotMeta, createdAt: serverTimestamp() })
    } else {
      await deleteDoc(ref)
    }
  } catch (err) {
    console.error('toggleFavouriteQuestion failed', err)
  }
  return Boolean(on)
}

/** Read a teacher's favourite question ids. */
export async function listFavouriteIds(uid) {
  if (!uid) return new Set()
  try {
    const snap = await getDocs(query(collection(db, 'questionBankFavourites', uid, 'items'), limit(FETCH_LIMIT)))
    return new Set(snap.docs.map(d => d.data()?.questionId).filter(Boolean))
  } catch (err) {
    console.error('listFavouriteIds failed', err)
    return new Set()
  }
}

/** Fetch a single bank row by id (for the full-preview modal / admin actions). */
export async function getBankQuestion(id) {
  if (!id) return null
  try {
    const snap = await getDoc(doc(db, 'questionBank', id))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (err) {
    console.error('getBankQuestion failed', err)
    return null
  }
}
