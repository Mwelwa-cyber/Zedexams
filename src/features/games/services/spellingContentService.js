/**
 * `spellingWords` — the reviewed spelling content, and the two very different
 * doors onto it.
 *
 * THE LEARNER DOOR reads APPROVED words for one grade and nothing else. The
 * rule enforces that (a learner may not list a draft), and
 * `servableToLearner` re-checks it on the way in, because an approval is only
 * as good as the machine checks it sits on top of.
 *
 * THE ADMIN DOOR reads everything and writes anything, and is the only place
 * a record's `approved` flag can be set. That flag is a HUMAN act — an AI may
 * fill in a sentence, a cut and an explanation, and it lands as `pending`
 * every time. Nothing in this file can promote a record on its own.
 *
 * WHY A COLLECTION AT ALL, GIVEN THE BUNDLED BANK. `src/data/spellingBank.js`
 * is 879 hand-authored Grade 7 words and stays exactly where it is: it is the
 * approved BASELINE, it costs no read, and it is what a learner plays when
 * Firestore is unreachable. The collection is what lets the content grow
 * without a deploy and what opens the next grade — see `mergeIntoPack`, which
 * is deliberately a merge and not a replacement.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, limit as fsLimit, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db, auth } from '../../../firebase/config'
import { withFirestoreReadTimeout } from '../../../utils/firestoreTimeout'
import {
  LEARNER_STATUS,
  normaliseWord,
  servableToLearner,
  validateWord,
  wordDocId,
} from '../lib/spellingContentCore'

const COLLECTION = 'spellingWords'

/** A ceiling on any one read. A grade's whole bank is well under this. */
const MAX_WORDS = 2000

function nowStamp() {
  return serverTimestamp()
}

/* ── the learner door ──────────────────────────────────────────────── */

/**
 * Approved, active words for one grade.
 *
 * A FAILED READ RETURNS AN EMPTY LIST, and the caller reads that as "the
 * bundled bank stands" rather than "this grade has no words" — which is why
 * `mergeIntoPack` treats an empty result as a no-op rather than as a bank to
 * render. A grade with genuinely no Firestore words is the normal case today.
 */
export async function listApprovedWords(grade) {
  try {
    const q = query(
      collection(db, COLLECTION),
      where('grade', '==', Number(grade)),
      where('status', '==', LEARNER_STATUS),
      where('active', '==', true),
      fsLimit(MAX_WORDS),
    )
    const snap = await withFirestoreReadTimeout(getDocs(q), 'spelling words')
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // Fail closed. `approved` and `status` are two fields and a record that
      // somehow carries one without the other is not shown to a child.
      .filter((row) => servableToLearner(row))
      .map((row) => normaliseWord(row))
  } catch {
    return []
  }
}

/* ── the admin door ────────────────────────────────────────────────── */

/** Every word for a grade, whatever its state. Admin only, by rule. */
export async function listWordsForAdmin({ grade = null } = {}) {
  const parts = [collection(db, COLLECTION)]
  if (grade != null && grade !== '') parts.push(where('grade', '==', Number(grade)))
  parts.push(orderBy('word'), fsLimit(MAX_WORDS))
  const snap = await withFirestoreReadTimeout(getDocs(query(...parts)), 'spelling words (admin)')
  return snap.docs.map((d) => ({ id: d.id, ...normaliseWord(d.data()) }))
}

export async function getWord(id) {
  const snap = await withFirestoreReadTimeout(getDoc(doc(db, COLLECTION, id)), 'spelling word')
  return snap.exists() ? { id: snap.id, ...normaliseWord(snap.data()) } : null
}

/**
 * Create or update one word.
 *
 * VALIDATION HAPPENS HERE AS WELL AS IN THE FORM, and that is not belt and
 * braces — the form is one caller and the bulk importer is another. A record
 * that fails a machine check is REFUSED, not saved-with-a-warning, because
 * "malformed spelling data must never silently reach learners" is the whole
 * point of the collection having a shape at all.
 *
 * `approved` cannot be set by this path without `status: 'approved'`; the two
 * move together through `setApproval` so there is one act to audit.
 */
export async function saveWord(raw, { bands = null } = {}) {
  const record = normaliseWord(raw)
  const problems = validateWord(record, { bands })
  if (problems.length) {
    const err = new Error(problems[0])
    err.code = 'spelling/invalid'
    err.problems = problems
    throw err
  }
  const id = raw?.id || wordDocId(record)
  const existing = raw?.id ? await getWord(id) : null

  await setDoc(
    doc(db, COLLECTION, id),
    {
      ...record,
      // An EDIT to approved content sends it back for review. A sentence or a
      // cut that has changed has not been approved — the old approval was of
      // different words. Only `setApproval` grants one.
      status: existing && changesContent(existing, record) ? 'pending' : record.status,
      approved: existing && changesContent(existing, record) ? false : record.approved,
      updatedAt: nowStamp(),
      updatedBy: auth.currentUser?.uid || null,
      ...(existing ? {} : { createdAt: nowStamp(), createdBy: auth.currentUser?.uid || null }),
    },
    { merge: true },
  )
  return id
}

/** Did an edit touch anything a reviewer approved? Housekeeping fields do not. */
export function changesContent(before, after) {
  const fields = ['word', 'contextSentence', 'chunks', 'trap', 'strategy', 'hook', 'hookNote', 'why', 'relatedWords', 'band', 'grade']
  return fields.some((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null))
}

/**
 * Approve or reject. The ONE place `approved` becomes true, and it re-runs the
 * machine checks first: a reviewer's judgement is about the cut and the
 * sentence, and it does not override a chunk list that does not rebuild.
 */
export async function setApproval(id, { approved, note = '', bands = null } = {}) {
  const record = await getWord(id)
  if (!record) throw new Error('That word no longer exists.')
  if (approved) {
    const problems = validateWord(record, { bands })
    if (problems.length) {
      const err = new Error(`Cannot approve: ${problems[0]}`)
      err.problems = problems
      throw err
    }
  }
  await setDoc(
    doc(db, COLLECTION, id),
    {
      status: approved ? 'approved' : 'rejected',
      approved: Boolean(approved),
      reviewNote: String(note || '').slice(0, 500),
      reviewedAt: nowStamp(),
      reviewedBy: auth.currentUser?.uid || null,
      updatedAt: nowStamp(),
    },
    { merge: true },
  )
}

/** Deactivate keeps the record and takes it off the learner's ladder. */
export async function setWordActive(id, active) {
  await setDoc(
    doc(db, COLLECTION, id),
    { active: Boolean(active), updatedAt: nowStamp(), updatedBy: auth.currentUser?.uid || null },
    { merge: true },
  )
}

/** Delete for good. Deactivating is almost always what is actually wanted. */
export async function deleteWord(id) {
  await deleteDoc(doc(db, COLLECTION, id))
}

/* ── pronunciation ─────────────────────────────────────────────────── */

/**
 * Voice a batch of words through the server.
 *
 * The synthesis, the ElevenLabs key and the Storage write all live in the
 * callable — none of them can be here, because a provider key in a bundle is
 * a public key. This function's whole job is to hand over ids and read back
 * what happened.
 *
 * Batched at the SERVER's limit rather than a number chosen here, so the two
 * cannot drift: the reply reports `maxBatch` and `overflow`, and the caller
 * pages until nothing is left.
 */
export async function generateAudioForWords(words, { force = false, voice = '' } = {}) {
  const call = httpsCallable(getFunctions(app, 'us-central1'), 'generateSpellingAudio')
  const res = await call({
    // Only what the server needs. It re-reads everything else from the record
    // it is about to stamp.
    words: (words || []).map((w) => ({ id: w.id, word: w.word, grade: w.grade })),
    force,
    ...(voice ? { voice } : {}),
  })
  return res?.data || null
}

/* ── bulk import ───────────────────────────────────────────────────── */

/**
 * Import rows into the collection. IDEMPOTENT by construction — the doc id is
 * derived from grade + word, so re-running converges on one document per word
 * instead of minting duplicates, exactly as the games seed importer does.
 *
 * An existing word is SKIPPED rather than merged over: overwriting would
 * silently discard an admin's edit and, worse, could re-approve something a
 * reviewer had rejected. `force` is the explicit override.
 *
 * Rows are validated first and the invalid ones are REPORTED, never written
 * and never silently dropped — a bulk import that says "412 imported" while
 * having skipped 60 malformed rows is how bad content becomes invisible.
 */
export async function importWords(rows, { bands = null, force = false, status = 'pending', onProgress = null } = {}) {
  const prepared = []
  const rejected = []
  for (const raw of rows || []) {
    const record = normaliseWord({ ...raw, status, approved: status === LEARNER_STATUS && raw.approved === true })
    const problems = validateWord(record, { bands })
    if (problems.length) rejected.push({ word: record.word || '(no word)', problems })
    else prepared.push(record)
  }

  let imported = 0
  let skipped = 0
  // Firestore caps a batch at 500 writes; the existence check has to happen
  // before the batch, so the read is done in the same chunk to keep the two
  // from drifting apart on a long import.
  const CHUNK = 200
  for (let i = 0; i < prepared.length; i += CHUNK) {
    const slice = prepared.slice(i, i + CHUNK)
    const ids = slice.map((record) => wordDocId(record))
    const existing = force
      ? new Set()
      : new Set(
        (await Promise.all(ids.map((id) => getDoc(doc(db, COLLECTION, id)))))
          .filter((snap) => snap.exists())
          .map((snap) => snap.id),
      )
    const batch = writeBatch(db)
    slice.forEach((record, index) => {
      const id = ids[index]
      if (existing.has(id)) { skipped += 1; return }
      batch.set(doc(db, COLLECTION, id), {
        ...record,
        createdAt: nowStamp(),
        createdBy: auth.currentUser?.uid || null,
        updatedAt: nowStamp(),
      }, { merge: force })
      imported += 1
    })
    await batch.commit()
    if (onProgress) onProgress({ done: Math.min(i + CHUNK, prepared.length), total: prepared.length })
  }

  return { imported, skipped, rejected, total: (rows || []).length }
}
