/**
 * `spellingSentences` — the Word Choice content, and the two doors onto it.
 *
 * The learner door reads APPROVED, ACTIVE sentences and nothing else; the
 * rule enforces it and `servableSentence` re-checks it on the way in. The
 * admin door reads everything and is the only place `approved` is set.
 *
 * WHY A COLLECTION AT ALL, GIVEN THE BUNDLED BANK. `src/data/spellingChoiceBank.js`
 * is the reviewed baseline: it costs no read, it works offline, and it is what
 * a learner plays when Firestore is unreachable. The collection is what lets
 * Mwelwa fix a wrong sentence — or add one after a marking meeting — without a
 * release. `mergeChoiceItems` folds one over the other, and it is a merge in
 * that direction deliberately: four Firestore rows must not replace
 * fifty-seven bundled ones.
 *
 * A FAILED READ IS AN EMPTY LIST, never an error the game has to handle. The
 * caller reads empty as "the bundled bank stands", which is also the normal
 * case today — the collection is empty until somebody edits something.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, orderBy, limit as fsLimit, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from '../../../firebase/config'
import { withFirestoreReadTimeout } from '../../../utils/firestoreTimeout'
import {
  LEARNER_STATUS,
  normaliseSentence,
  sentenceDocId,
  servableSentence,
  validateSentence,
} from '../lib/spellingSentenceCore'

const COLLECTION = 'spellingSentences'

/** The rule's own ceiling. The whole reviewed set is far under it. */
const MAX_SENTENCES = 500

/* ── the learner door ──────────────────────────────────────────────── */

/**
 * Approved, active sentences, optionally narrowed to one grade.
 *
 * The grade is filtered CLIENT-SIDE rather than in the query, because a
 * sentence that names no grade serves every grade — and an equality filter on
 * `grade` would drop exactly those, which is most of them. The two conditions
 * that matter for safety are in the query, where the rule can see them.
 */
export async function listApprovedSentences(grade = null) {
  try {
    const q = query(
      collection(db, COLLECTION),
      where('status', '==', LEARNER_STATUS),
      where('active', '==', true),
      fsLimit(MAX_SENTENCES),
    )
    const snap = await withFirestoreReadTimeout(getDocs(q), 'spelling sentences')
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // Fail closed, then normalise. A record that passes the flags but fails
      // a machine check is not shown to a child.
      .filter((row) => servableSentence(row))
      .map((row) => normaliseSentence({ ...row, id: row.id }))
      .filter((row) => grade == null || row.grade == null || Number(row.grade) === Number(grade))
  } catch {
    return []
  }
}

/* ── the admin door ────────────────────────────────────────────────── */

/** Every sentence, whatever its state. Admin only, by rule. */
export async function listSentencesForAdmin() {
  const snap = await withFirestoreReadTimeout(
    getDocs(query(collection(db, COLLECTION), orderBy('answer'), fsLimit(MAX_SENTENCES))),
    'spelling sentences (admin)',
  )
  return snap.docs.map((d) => ({ ...normaliseSentence({ ...d.data(), id: d.id }) }))
}

export async function getSentence(id) {
  const snap = await withFirestoreReadTimeout(getDoc(doc(db, COLLECTION, id)), 'spelling sentence')
  return snap.exists() ? normaliseSentence({ ...snap.data(), id: snap.id }) : null
}

/**
 * Create or update one sentence.
 *
 * VALIDATION HAPPENS HERE AS WELL AS IN THE FORM, because the form is one
 * caller and a bulk import would be another. A record that fails a machine
 * check is REFUSED rather than saved with a warning.
 *
 * EDITING AN APPROVED SENTENCE SENDS IT BACK FOR REVIEW — the same rule the
 * word editor follows. An approval is a statement about the text somebody
 * read, so changing the text withdraws it.
 */
export async function saveSentence(raw) {
  const record = normaliseSentence(raw)
  const problems = validateSentence(record)
  if (problems.length) {
    const err = new Error(problems[0])
    err.code = 'spelling/invalid-sentence'
    err.problems = problems
    throw err
  }

  const id = sentenceDocId(record)
  const existing = await getSentence(id)
  const textChanged = existing
    && (existing.text !== record.text
      || existing.answer !== record.answer
      || existing.distractors.join('|') !== record.distractors.join('|'))

  const status = textChanged && existing.status === LEARNER_STATUS ? 'pending' : record.status
  const approved = status === LEARNER_STATUS && record.approved

  await setDoc(doc(db, COLLECTION, id), {
    id,
    text: record.text,
    answer: record.answer,
    distractors: record.distractors,
    note: record.note,
    grade: record.grade,
    status,
    approved,
    active: record.active,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.uid || null,
    ...(existing ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true })

  return { id, status, approved, sentBackForReview: Boolean(textChanged && existing.status === LEARNER_STATUS) }
}

/**
 * Approve or un-approve. The two fields move TOGETHER so there is one act to
 * audit, and so no record can carry `approved: true` with a draft status —
 * which is the state `servableSentence` fails closed on.
 */
export async function setSentenceApproval(id, approved) {
  await setDoc(doc(db, COLLECTION, id), {
    status: approved ? LEARNER_STATUS : 'pending',
    approved: Boolean(approved),
    reviewedAt: serverTimestamp(),
    reviewedBy: auth.currentUser?.uid || null,
  }, { merge: true })
}

export async function deleteSentence(id) {
  await deleteDoc(doc(db, COLLECTION, id))
}
