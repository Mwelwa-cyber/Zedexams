/**
 * The authoring write path — quizzes, questions and teacher-private
 * assessments, plus the "my own content" lists that only an author reads.
 *
 * ## This is the module that must never be reachable from a learner screen
 *
 * It owns the four heavy dependencies: the quiz write schema, the question
 * schema, the Zod-validated question-write normaliser (which lazy-loads the
 * Tiptap pipeline) and the quiz cascade delete. None of them has any business
 * on a learner's first paint, and keeping them behind one module makes that
 * checkable — `npm run test:learner-data-boundary` asserts the learner read
 * path does not reach any of these names, directly or transitively.
 *
 * Every function body is unchanged from `useFirestore`.
 */
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../../firebase/config'
import { deleteQuizWithQuestions } from '../../utils/deleteQuizWithQuestions.js'
import { isAssessmentDeleted } from '../../utils/assessmentDeletion.js'
import { coerceQuestion } from '../../editor/schema/question.js'
import { quizWriteSchema, quizUpdateSchema } from '../../shared/schemas/quiz.js'
import { normalizeSubject } from '../../config/curriculum.js'
// The question-write normaliser (dual HTML+JSON format, Zod-validated) lives
// in src/utils/questionWritePayload.js so the Firestore-rules emulator suite
// can replay REAL editor payloads through the exact production function. It
// still lazy-loads the Tiptap write pipeline, so the editor stays out of the
// eager entry chunk (see the module's docstring).
import { normalizeQuestionPayload } from '../../utils/questionWritePayload.js'
import { TEACHER_QUERY_LIMIT, reportRead } from './internal.js'

export async function createQuiz(data) {
  // Validate the full payload before it hits Firestore. quizWriteSchema is
  // permissive on unknown fields (passthrough) but strict on the ones we
  // know — a typo or wrong-type value fails loudly on the form instead of
  // silently writing garbage that later blanks the learner runner.
  const parsed = quizWriteSchema.safeParse(data)
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    const path = first?.path?.join('.') || '(root)'
    throw new Error(`Invalid quiz payload at "${path}": ${first?.message || 'schema violation'}`)
  }
  const ref = await addDoc(collection(db, 'quizzes'), { ...parsed.data, createdAt: serverTimestamp() })
  return ref.id
}

export async function updateQuiz(quizId, data) {
  // updateDoc is a PATCH — only the supplied fields are touched, so we
  // validate against the partial schema. Unknown fields still pass through
  // unchanged thanks to passthrough; the gain is catching e.g. a stray
  // `status: 'archived'` (not in the enum) before it lands.
  const parsed = quizUpdateSchema.safeParse(data)
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    const path = first?.path?.join('.') || '(root)'
    throw new Error(`Invalid quiz update at "${path}": ${first?.message || 'schema violation'}`)
  }
  await updateDoc(doc(db, 'quizzes', quizId), parsed.data)
}

export async function deleteQuiz(quizId) {
  await deleteQuizWithQuestions(db, quizId)
}

export async function getQuestions(quizId) {
  try {
    const snap = await getDocs(query(collection(db, 'quizzes', quizId, 'questions'), orderBy('order', 'asc')))
    return snap.docs.map(d => coerceQuestion({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (e) { reportRead('getQuestions', e); return [] }
}

export async function saveQuestions(quizId, questions) {
  // Firestore caps writeBatch at 500 operations. Chunk to stay well under it.
  const chunkSize = 490
  for (let i = 0; i < questions.length; i += chunkSize) {
    const chunk = questions.slice(i, i + chunkSize)
    const batch = writeBatch(db)
    for (const [offset, q] of chunk.entries()) {
      const ref = doc(collection(db, 'quizzes', quizId, 'questions'))
      batch.set(ref, await normalizeQuestionPayload(q, i + offset + 1))
    }
    await batch.commit()
  }
}

/**
 * Delete a single question from a quiz subcollection.
 */
export async function deleteQuestion(quizId, questionId) {
  await deleteDoc(doc(db, 'quizzes', quizId, 'questions', questionId))
}

/**
 * Atomically update a quiz's metadata + its questions.
 * - Deletes questions whose IDs are in deletedIds
 * - Updates questions that have a _id field (existing)
 * - Adds questions without a _id field (new)
 * Split into two batches (delete + upsert) to stay within the 500-op limit.
 */
export async function updateQuizWithQuestions(quizId, quizData, questions, deletedIds = []) {
  const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)

  // 1. Update quiz doc — validate the metadata the same way updateQuiz does.
  //    This is the HOT autosave path, so a raw write here used to bypass the
  //    schema entirely: a stray subject slug or out-of-range field would
  //    either land verbatim in Firestore or fail later with an opaque
  //    permission error. quizUpdateSchema is .partial() + .passthrough(), so
  //    it coerces subject via normalizeSubject and validates known fields
  //    while preserving ad-hoc ones (reviewCount, mode, importStatus, …).
  const parsed = quizUpdateSchema.safeParse({
    ...quizData,
    questionCount: questions.length,
    totalMarks,
  })
  if (!parsed.success) {
    const first = parsed.error.issues?.[0]
    const path = first?.path?.join('.') || '(root)'
    throw new Error(`Invalid quiz update at "${path}": ${first?.message || 'schema violation'}`)
  }
  await updateDoc(doc(db, 'quizzes', quizId), {
    ...parsed.data,
    updatedAt: serverTimestamp(),
  })

  // 2. Delete removed questions
  if (deletedIds.length > 0) {
    const delBatch = writeBatch(db)
    deletedIds.forEach(id => delBatch.delete(doc(db, 'quizzes', quizId, 'questions', id)))
    await delBatch.commit()
  }

  // 3. Upsert remaining questions in chunks of 490.
  //    Return the assigned Firestore ID for every question so callers can
  //    patch _id back into React state. Without this, questions that start
  //    with _id:null (e.g. freshly imported) get re-created as new Firestore
  //    docs on every subsequent auto-save — producing the "60 → 2000"
  //    question-count explosion reported by teachers.
  const idMap = []
  const chunkSize = 490
  for (let i = 0; i < questions.length; i += chunkSize) {
    const chunk = questions.slice(i, i + chunkSize)
    const upsertBatch = writeBatch(db)
    for (const [offset, q] of chunk.entries()) {
      const cleanQ = await normalizeQuestionPayload(q, i + offset + 1)
      if (q._id) {
        upsertBatch.update(doc(db, 'quizzes', quizId, 'questions', q._id), cleanQ)
        idMap.push({ localId: q.localId, id: q._id })
      } else {
        const newRef = doc(collection(db, 'quizzes', quizId, 'questions'))
        upsertBatch.set(newRef, cleanQ)
        idMap.push({ localId: q.localId, id: newRef.id })
      }
    }
    await upsertBatch.commit()
  }
  return idMap
}

export async function getMyQuizzes(uid, limitCount = TEACHER_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'quizzes'), where('createdBy', '==', uid), orderBy('createdAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getMyQuizzes', e); return [] }
}

export async function getMyLessons(uid, limitCount = TEACHER_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(collection(db, 'lessons'), where('createdBy', '==', uid), orderBy('createdAt', 'desc'), limit(limitCount)))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) { reportRead('getMyLessons', e); return [] }
}

export async function getMyAssessments(uid, limitCount = TEACHER_QUERY_LIMIT) {
  try {
    const snap = await getDocs(query(
      collection(db, 'assessments'),
      where('createdBy', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(limitCount),
    ))
    // Exclude any paper tombstoned this session — Firestore's offline cache
    // can briefly still return a just-deleted doc; the registry filter stops
    // it resurfacing in the studio's recent-papers list (and anywhere else
    // this read feeds).
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(a => !isAssessmentDeleted(a.id))
  } catch (e) {
    // Log + forward to telemetry before re-throwing so callers can
    // distinguish "zero results" (genuine empty, returns [] above) from
    // "read failed" (throws here). Callers must track the error and show
    // a retryable error state rather than a false "no papers yet" empty.
    reportRead('getMyAssessments', e)
    throw e
  }
}

export async function getAssessmentById(assessmentId) {
  try {
    const snap = await getDoc(doc(db, 'assessments', assessmentId))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (e) {
    // Log + forward to telemetry before re-throwing so the caller can
    // distinguish "doc does not exist" (returns null above) from "read failed"
    // (throws here). The AssessmentStudio edit loader catches this and shows
    // a retryable 'loadfailed' state instead of a false "not found" message.
    reportRead('getAssessmentById', e)
    throw e
  }
}

// Assessments have no Zod schema yet, so subject parity with quizzes/lessons
// is enforced with a lightweight normalize: repair a stray curriculum slug
// ("mathematics") to its display label ("Mathematics") on the way in.
function withNormalizedAssessmentSubject(data) {
  if (data && typeof data === 'object' && 'subject' in data) {
    return { ...data, subject: normalizeSubject(data.subject) }
  }
  return data
}

export async function createAssessment(data) {
  const ref = await addDoc(collection(db, 'assessments'), {
    ...withNormalizedAssessmentSubject(data),
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateAssessment(assessmentId, data) {
  await updateDoc(doc(db, 'assessments', assessmentId), {
    ...withNormalizedAssessmentSubject(data),
    updatedAt: serverTimestamp(),
  })
}

export async function deleteAssessment(assessmentId) {
  // Mirror deleteQuizWithQuestions cascade: remove all questions in the
  // subcollection first, then the parent doc. Chunk to stay under the 500
  // batch-op limit.
  const qSnap = await getDocs(collection(db, 'assessments', assessmentId, 'questions'))
  const questionIds = qSnap.docs.map(d => d.id)
  const chunkSize = 490
  for (let i = 0; i < questionIds.length; i += chunkSize) {
    const batch = writeBatch(db)
    questionIds.slice(i, i + chunkSize).forEach(qId => {
      batch.delete(doc(db, 'assessments', assessmentId, 'questions', qId))
    })
    await batch.commit()
  }
  await deleteDoc(doc(db, 'assessments', assessmentId))
}

export async function getAssessmentQuestions(assessmentId) {
  try {
    const snap = await getDocs(query(
      collection(db, 'assessments', assessmentId, 'questions'),
      orderBy('order', 'asc'),
    ))
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    // Log + forward to telemetry before re-throwing. A genuine empty
    // subcollection returns [] above (Firestore returns an empty snapshot,
    // not an error); reaching here means the read itself failed.
    reportRead('getAssessmentQuestions', e)
    throw e
  }
}

export async function saveAssessmentQuestions(assessmentId, questions) {
  // Return the Firestore ID assigned to every freshly-created question so the
  // caller can patch `_id` back into React state. The Assessment Studio keeps
  // editing the same paper in place (via createdIdRef) after this first
  // create, so without the write-back every question would still carry
  // `_id:null` and the NEXT autosave (which takes the update branch) would
  // re-create all of them — the "30 → 90" duplication reported for papers.
  const idMap = []
  const chunkSize = 490
  for (let i = 0; i < questions.length; i += chunkSize) {
    const chunk = questions.slice(i, i + chunkSize)
    const batch = writeBatch(db)
    for (const [offset, q] of chunk.entries()) {
      const ref = doc(collection(db, 'assessments', assessmentId, 'questions'))
      batch.set(ref, await normalizeQuestionPayload(q, i + offset + 1))
      idMap.push({ localId: q.localId, id: ref.id })
    }
    await batch.commit()
  }
  return idMap
}

/**
 * Atomically update an assessment's metadata + its questions.
 * Mirrors updateQuizWithQuestions but writes to the `assessments` collection.
 */
export async function updateAssessmentWithQuestions(assessmentId, assessmentData, questions, deletedIds = []) {
  const totalMarks = questions.reduce((s, q) => s + (q.marks || 1), 0)

  await updateDoc(doc(db, 'assessments', assessmentId), {
    ...withNormalizedAssessmentSubject(assessmentData),
    questionCount: questions.length,
    totalMarks,
    updatedAt: serverTimestamp(),
  })

  if (deletedIds.length > 0) {
    const delBatch = writeBatch(db)
    deletedIds.forEach(id => delBatch.delete(doc(db, 'assessments', assessmentId, 'questions', id)))
    await delBatch.commit()
  }

  // Return the assigned Firestore ID for every question so callers can patch
  // `_id` back into React state. Without this, questions that start with
  // `_id:null` (freshly generated / imported / hand-added) get re-created as
  // new docs on every subsequent autosave — the "30 → 90" question-count
  // explosion. This mirrors updateQuizWithQuestions, whose identical fix
  // (PR #674) stopped the same growth on the quiz side.
  const idMap = []
  const chunkSize = 490
  for (let i = 0; i < questions.length; i += chunkSize) {
    const chunk = questions.slice(i, i + chunkSize)
    const upsertBatch = writeBatch(db)
    for (const [offset, q] of chunk.entries()) {
      const cleanQ = await normalizeQuestionPayload(q, i + offset + 1)
      if (q._id) {
        upsertBatch.update(doc(db, 'assessments', assessmentId, 'questions', q._id), cleanQ)
        idMap.push({ localId: q.localId, id: q._id })
      } else {
        const newRef = doc(collection(db, 'assessments', assessmentId, 'questions'))
        upsertBatch.set(newRef, cleanQ)
        idMap.push({ localId: q.localId, id: newRef.id })
      }
    }
    await upsertBatch.commit()
  }
  return idMap
}
