/**
 * AI-generated practice quiz — learner-side service.
 *
 * Connects the published `aiGeneratedContent` artifacts produced by
 * the learner-AI pipeline to the learner dashboard. Three jobs:
 *   1. listPublishedPracticeQuizzesForLearner  — Firestore onSnapshot
 *      query scoped to the learner's grade + published status only.
 *   2. loadPracticeQuiz                        — single-doc fetch
 *      with defensive status re-check (defence in depth: rules say
 *      learners can only read published, but the runner also refuses
 *      anything stale).
 *   3. submitAiPracticeQuizAttempt             — scores the attempt,
 *      writes a `results` row, queues 2 downstream tasks
 *      (weakness_analysis + learner_feedback) on the aiAgentTasks
 *      collection. study_tips is queued downstream by the Weakness
 *      runner itself when it finds signals (no need to queue it here).
 *
 * Pure scoring + payload builders live in `aiPracticeQuizScoring.js`
 * (re-exported below) so they can be unit-tested without firebase.
 *
 * Hard rules:
 *   - The list query never touches draft / needs_review / rejected /
 *     regenerate_required artifacts (Firestore rule + explicit
 *     status filter).
 *   - Never writes to `quizzes` or the teacher pipeline.
 *   - Submission writes carry `aiContentId` + `source:'ai_practice'`
 *     on the `results` doc so existing teacher analytics can opt out
 *     by filtering `source !== 'ai_practice'` if they choose.
 */

import {
  addDoc, collection, doc, getDoc, limit as fsLimit, onSnapshot,
  orderBy, query, serverTimestamp, where,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  buildResultDocBase,
  buildWeaknessTaskPayload,
  buildFeedbackTaskPayload,
  scoreAttempt,
} from './aiPracticeQuizScoring'

export {
  markQuestion,
  scoreAttempt,
  buildResultDocBase,
  buildWeaknessTaskPayload,
  buildFeedbackTaskPayload,
  estimatedMinutesForQuiz,
  describeDifficulty,
} from './aiPracticeQuizScoring'

const CONTENT_COLLECTION = 'aiGeneratedContent'
const TASKS_COLLECTION = 'aiAgentTasks'
const RESULTS_COLLECTION = 'results'

// ── List ───────────────────────────────────────────────────────────

/**
 * onSnapshot subscriber. Returns an `unsubscribe` function.
 *
 * @param {object} args
 * @param {string|number} args.grade   the learner's registered grade
 * @param {function} args.onChange     (artifacts[]) => void
 * @param {function} [args.onError]    (err) => void
 * @param {number}   [args.limit=60]
 * @returns {function} unsubscribe
 */
export function listPublishedPracticeQuizzesForLearner({
  grade, onChange, onError, limit: pageLimit = 60,
}) {
  if (!grade || !onChange) {
    if (onChange) onChange([])
    return () => {}
  }
  const q = query(
    collection(db, CONTENT_COLLECTION),
    where('type', '==', 'practice_quiz'),
    where('status', '==', 'published'),
    where('grade', '==', String(grade)),
    orderBy('createdAt', 'desc'),
    fsLimit(pageLimit),
  )
  return onSnapshot(
    q,
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { if (onError) onError(err) },
  )
}

/**
 * Single-doc fetch for the runner. Refuses to return anything whose
 * status is not 'published' OR whose grade doesn't match the learner.
 * The Firestore rule already prevents the read in the first place
 * for non-published docs; the grade check here is a defence against
 * a tampered URL.
 */
export async function loadPracticeQuiz({ contentId, learnerGrade }) {
  if (!contentId) throw new Error('contentId required')
  const snap = await getDoc(doc(db, CONTENT_COLLECTION, contentId))
  if (!snap.exists()) {
    const err = new Error('Quiz not found')
    err.code = 'not_found'
    throw err
  }
  const data = snap.data() || {}
  if (data.type !== 'practice_quiz') {
    const err = new Error('Wrong content type')
    err.code = 'wrong_type'
    throw err
  }
  if (data.status !== 'published') {
    const err = new Error('This quiz is not published')
    err.code = 'not_published'
    throw err
  }
  if (learnerGrade != null && String(data.grade) !== String(learnerGrade)) {
    const err = new Error(`This quiz is for Grade ${data.grade}, not your grade`)
    err.code = 'grade_mismatch'
    throw err
  }
  return { id: snap.id, ...data }
}

// ── Submission ─────────────────────────────────────────────────────

/**
 * Build the full `results/{id}` payload including the server
 * timestamp. Pure-builder pieces live in aiPracticeQuizScoring.js;
 * we stamp completedAt here because serverTimestamp() is a Firebase
 * sentinel and shouldn't leak into the unit-tested module.
 */
export function buildResultDoc({ artifact, scored, learnerId, learnerGrade }) {
  return {
    ...buildResultDocBase({ artifact, scored, learnerId, learnerGrade }),
    completedAt: serverTimestamp(),
  }
}

/**
 * Submit a completed attempt:
 *   1. Write `results/{newId}` with the scored attempt
 *   2. Queue 2 downstream agent tasks: weakness_analysis (kicks off
 *      study_tips automatically when signals exist) + learner_feedback
 *
 * Note: Weakness Detection's runner already queues a follow-up
 * `study_tips` task internally when it finds weakness signals (see
 * functions/agents/learnerAi/runners/weakness.js → maybeQueueStudyTips),
 * so we don't need to queue study_tips directly from here.
 *
 * Returns { resultId, weaknessTaskId, feedbackTaskId, scored }.
 */
export async function submitAiPracticeQuizAttempt({
  artifact, answers, learnerId, learnerGrade,
}) {
  if (!artifact || !artifact.id) throw new Error('artifact required')
  if (!learnerId) throw new Error('learnerId required')

  const content = artifact.content || {}
  const scored = scoreAttempt({ content, answers })

  // 1. Write the results doc.
  const resultPayload = buildResultDoc({ artifact, scored, learnerId, learnerGrade })
  const resultRef = await addDoc(collection(db, RESULTS_COLLECTION), resultPayload)

  // 2. Queue Weakness Detection task. The runner itself triggers
  //    Study Tips when it finds signals.
  let weaknessTaskId = null
  try {
    const ref = await addDoc(collection(db, TASKS_COLLECTION), {
      ...buildWeaknessTaskPayload({ artifact, learnerId, resultId: resultRef.id }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    weaknessTaskId = ref.id
  } catch (err) {
    // Best-effort — surface to the caller via the return value but
    // never block the result write.
    console.warn('[aiPractice] weakness task queue failed', err && err.message)
  }

  // 3. Queue Learner Feedback task — tied to THIS attempt + learner.
  let feedbackTaskId = null
  try {
    const ref = await addDoc(collection(db, TASKS_COLLECTION), {
      ...buildFeedbackTaskPayload({ artifact, learnerId, resultId: resultRef.id }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    feedbackTaskId = ref.id
  } catch (err) {
    console.warn('[aiPractice] feedback task queue failed', err && err.message)
  }

  return {
    resultId: resultRef.id,
    weaknessTaskId,
    feedbackTaskId,
    scored,
  }
}
