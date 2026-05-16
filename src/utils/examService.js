/**
 * Daily Exam Service
 *
 * Implements the two-system separation:
 *   - Daily Exams  → this file (timed, competitive, once per subject per day)
 *   - Practice Quizzes → existing QuizRunnerV2 + results collection (unchanged)
 *
 * Firestore collections used:
 *   exam_attempts/{attemptId}   — in-progress and completed exam state
 *   daily_exam_locks/{lockId}   — one-per-user-per-subject-per-day enforcement
 *
 * Lock document ID format: {userId}_{subject}_{YYYY-MM-DD}
 *
 * Timer strategy:
 *   endTime is a fixed Unix-ms timestamp written to Firestore on startExam().
 *   On every restore, endTime is read from Firestore — never from localStorage.
 *   This prevents any client-side clock manipulation.
 *
 * Firebase / Cloud Function migration path:
 *   Replace submitExam() body with an httpsCallable('submitExam') call.
 *   The Firestore writes (score, percentage) move server-side so the client
 *   never touches scoring fields directly.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { buildQuizDisplaySections } from './quizSections'
import { coerceQuiz } from '../schemas/quiz.js'
import { coerceQuestion } from '../editor/schema/question.js'
import { attemptStartSchema, coerceAttempt } from '../schemas/attempt.js'
import { numericMatches } from './numericGrading.js'
import { hotspotMatches } from './hotspotGrading.js'

// Re-export so callers that already import { numericMatches } from
// './examService' (QuizRunnerV2, practice quizzes) keep working unchanged.
// Practice quizzes still grade client-side by design — only Daily Exams
// moved to server-authoritative grading.
export { numericMatches, hotspotMatches }

// Daily-exam grading + question delivery run server-side so the answer key
// never reaches a learner mid-exam and the score can't be tampered with.
const examFunctions = getFunctions(app, 'us-central1')
const getExamQuestionsCallable = httpsCallable(examFunctions, 'getExamQuestions')
const submitDailyExamCallable = httpsCallable(examFunctions, 'submitDailyExam')

function isNotFoundError(e) {
  return e?.code === 'functions/not-found' || e?.message === 'Attempt not found.'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function todayString() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lockId(userId, subject) {
  return `${userId}_${subject}_${todayString()}`
}

const LS_KEY = (userId, examId) => `zedexams:exam:${userId}:${examId}`

// ── Quiz / question fetching ──────────────────────────────────────────────────

/**
 * Fetch the quiz document + all questions for a given examId.
 * Returns { quiz, questions, sections } ready for the runner.
 *
 * Questions come from the `getExamQuestions` Cloud Function, not a direct
 * Firestore read: daily-exam questions are closed to clients in
 * firestore.rules so the answer key can't be scraped mid-exam. The
 * function strips answer-key fields unless `attemptId` belongs to a
 * SUBMITTED attempt (the corrections/review screen passes it then).
 *
 * Defensive shape rules: quiz.passages is coerced to an array before it
 * touches buildQuizDisplaySections (which already coerces internally — this
 * is belt-and-braces so a future caller can't accidentally re-introduce the
 * "s.forEach is not a function" crash that bit /exam/:id loaders).
 */
export async function getExamWithQuestions(examId, attemptId = null) {
  const quizSnap = await getDoc(doc(db, 'quizzes', examId))
  if (!quizSnap.exists()) return null

  const res = await getExamQuestionsCallable(
    attemptId ? { examId, attemptId } : { examId },
  )
  const rawQuestions = Array.isArray(res?.data?.questions) ? res.data.questions : []

  // Normalise the quiz at the read boundary. coerceQuiz guarantees
  // `passages` and `parts` are well-shaped arrays, so the downstream
  // builder + every UI reader can stop branching defensively. The local
  // `Array.isArray(quiz.passages)` guard below is left in place for now
  // as a second line of defence; safe to remove once every reader is on
  // coerceQuiz.
  const quiz = coerceQuiz({ id: quizSnap.id, ...quizSnap.data() })
  const questions = rawQuestions.map(q => coerceQuestion(q)).filter(Boolean)
  const safePassages = Array.isArray(quiz?.passages) ? quiz.passages : []
  const { sections } = buildQuizDisplaySections(questions, safePassages)

  return { quiz, questions, sections }
}

/**
 * Return today's daily exam quiz for a given subject + grade, or null if none.
 * A quiz qualifies when: isDailyExam == true, dailyExamDate == today,
 * subject matches, and isPublished == true.
 */
export async function getTodaysExam(subject, _grade) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'quizzes'),
        where('quizType', '==', 'daily_exam'),
        where('isDailyExam', '==', true),
        where('dailyExamDate', '==', todayString()),
        where('subject', '==', subject),
        limit(1),
      ),
    )
    if (snap.empty) return null
    const d = snap.docs[0]
    return coerceQuiz({ id: d.id, ...d.data() })
  } catch (e) {
    console.error('getTodaysExam:', e)
    return null
  }
}

// ── Daily lock ────────────────────────────────────────────────────────────────

/**
 * Returns the lock doc for this user+subject today, or null if not locked.
 * { status: 'in_progress' | 'submitted', attemptId, examId, ... }
 */
export async function checkDailyLock(userId, subject) {
  try {
    const snap = await getDoc(doc(db, 'daily_exam_locks', lockId(userId, subject)))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  } catch (e) {
    console.error('checkDailyLock:', e)
    return null
  }
}

// ── Exam lifecycle ────────────────────────────────────────────────────────────

/**
 * Start a fresh exam attempt.
 *
 * Checks the daily lock first:
 *   - lock exists + submitted  → return { alreadySubmitted, attemptId }
 *   - lock exists + in_progress → route through restoreExam()
 *   - no lock                  → create attempt + lock, return session
 *
 * The returned session object is what the runner component stores in state.
 */
export async function startExam(userId, displayName, exam) {
  const { id: examId, subject, grade, totalMarks, durationMinutes } = exam

  const existingLock = await checkDailyLock(userId, subject)
  if (existingLock) {
    if (existingLock.status === 'submitted') {
      return { alreadySubmitted: true, attemptId: existingLock.attemptId }
    }
    // in_progress: restore instead of creating a duplicate
    return restoreExam(userId, existingLock.attemptId)
  }

  const now = Date.now()
  // endTime is the only source of truth for remaining time.
  // It is written once here and never changed.
  const endTime = now + (durationMinutes || 30) * 60 * 1000
  const today = todayString()

  // Validate the new-attempt payload before it reaches Firestore so a
  // typo in this codebase or an upstream caller passing a malformed exam
  // doc fails loudly here, with a clear field-level error, instead of
  // succeeding now and crashing the runner later when /exam/:id reads it
  // back. See PR #379 for the failure mode this prevents.
  const attemptPayload = attemptStartSchema.parse({
    userId,
    displayName: displayName || 'Student',
    examId,
    subject,
    grade,
    attemptDate: today,
    status: 'in_progress',
    startedAt: serverTimestamp(),
    endTime,
    submittedAt: null,
    answers: {},
    flagged: [],
    currentSectionIndex: 0,
    score: null,
    totalMarks: totalMarks || 0,
    percentage: null,
    timeTakenSeconds: null,
  })
  const attemptRef = await addDoc(collection(db, 'exam_attempts'), attemptPayload)

  await setDoc(doc(db, 'daily_exam_locks', lockId(userId, subject)), {
    userId,
    subject,
    date: today,
    examId,
    attemptId: attemptRef.id,
    status: 'in_progress',
    lockedAt: serverTimestamp(),
  })

  const session = {
    attemptId: attemptRef.id,
    examId,
    endTime,
    answers: {},
    flagged: [],
    currentSectionIndex: 0,
  }

  _writeLocalSession(userId, examId, session)
  return session
}

/**
 * Restore an in-progress exam after a page reload.
 *
 * ALWAYS reads endTime from Firestore — the local cache is only used to
 * pre-populate answers so the UI doesn't flash empty on reload.
 */
export async function restoreExam(userId, attemptId) {
  const snap = await getDoc(doc(db, 'exam_attempts', attemptId))
  if (!snap.exists()) throw new Error('Attempt not found.')

  // coerceAttempt normalises the persisted shape — answers becomes a
  // plain object even if a stale doc has it as an array (PR #379), flagged
  // becomes a string[] even when the legacy object-map form is stored,
  // currentSectionIndex is always a finite int. The local safeAnswers /
  // safeFlagged blocks below remain as a second line of defence.
  const attempt = coerceAttempt(snap.data()) || {}

  if (attempt.status === 'submitted') {
    return { alreadySubmitted: true, attemptId }
  }

  // If the deadline already passed, auto-submit with whatever was saved.
  // Grading + the lock flip happen server-side (submitDailyExam); the
  // server loads the questions with the admin SDK, so the client no longer
  // needs (and is no longer allowed) to read the answer-bearing question
  // docs here.
  if (Date.now() >= attempt.endTime) {
    // Firestore answers are only written on submit; in-progress answers live
    // in localStorage (saveProgress). A learner who answered, lost
    // connectivity and never submitted would otherwise be auto-graded on an
    // empty `attempt.answers` → permanent 0%. Recover the locally-saved
    // answers and prefer them (they are the most recent).
    let recoveredAnswers = attempt.answers || {}
    try {
      const localRaw = localStorage.getItem(LS_KEY(userId, attempt.examId))
      const local = localRaw ? JSON.parse(localRaw) : null
      if (local && local.answers && typeof local.answers === 'object' && !Array.isArray(local.answers)) {
        recoveredAnswers = { ...recoveredAnswers, ...local.answers }
      }
    } catch (e) {
      console.error('restoreExam local answer recovery failed:', e)
    }
    try {
      await submitDailyExamCallable({ attemptId, answers: recoveredAnswers })
    } catch (e) {
      // Already submitted by a concurrent path is fine; anything else we
      // still treat as "done" so the learner isn't stuck on a dead exam.
      if (!isNotFoundError(e)) console.error('restoreExam auto-submit failed:', e)
    }
    try { localStorage.removeItem(LS_KEY(userId, attempt.examId)) } catch {}
    return { alreadySubmitted: true, attemptId, timeExpired: true }
  }

  // Coerce the persisted shapes to what the runner expects. A historical
  // quiz attempt could have `flagged` written as either an array (legacy)
  // or an object (current); the runner's setFlagged uses object spread so
  // both pass through, but we normalise here so downstream code never has
  // to branch. Same for `answers` — if a stale doc somehow has a non-object
  // value we degrade to {} rather than letting `answers[q.id]` throw later.
  const safeAnswers = (attempt.answers && typeof attempt.answers === 'object' && !Array.isArray(attempt.answers))
    ? attempt.answers
    : {}
  const safeFlagged = Array.isArray(attempt.flagged)
    ? attempt.flagged
    : (attempt.flagged && typeof attempt.flagged === 'object')
      ? attempt.flagged
      : []

  const session = {
    attemptId,
    examId: attempt.examId,
    endTime: attempt.endTime, // Firestore is authoritative
    answers: safeAnswers,
    flagged: safeFlagged,
    currentSectionIndex: Number.isFinite(attempt.currentSectionIndex) ? attempt.currentSectionIndex : 0,
  }

  _writeLocalSession(userId, attempt.examId, session)
  return session
}

/**
 * Persist answers + navigation to localStorage only.
 * Firestore is NOT written on every keystroke — only on submit.
 * This keeps costs low while keeping the session recoverable on refresh.
 */
export function saveProgress(userId, examId, patch) {
  try {
    const key = LS_KEY(userId, examId)
    const current = JSON.parse(localStorage.getItem(key) || '{}')
    localStorage.setItem(key, JSON.stringify({ ...current, ...patch, savedAt: Date.now() }))
  } catch {}
}

/**
 * Submit the exam. Grading, the exam_attempts write, and the daily-lock
 * flip all happen server-side in the `submitDailyExam` Cloud Function —
 * the client never computes or writes the score, and never holds the
 * answer key. `answers` is { [questionId]: value }. `questions` is no
 * longer needed (the server loads them with the admin SDK) but the
 * parameter is kept positionally for the existing call sites.
 *
 * Returns either { alreadySubmitted: true, attemptId } or
 * { alreadySubmitted: false, attemptId, score, percentage, ... }.
 */
export async function submitExam(userId, examId, attemptId, answers) {
  const res = await submitDailyExamCallable({ attemptId, answers })
  const result = res?.data || {}
  try { localStorage.removeItem(LS_KEY(userId, examId)) } catch {}
  if (result.alreadySubmitted) return { alreadySubmitted: true, attemptId }
  return { alreadySubmitted: false, attemptId: result.attemptId || attemptId, ...result }
}

/**
 * Auto-submit when the timer fires — same as submitExam but swallows the
 * "attempt not found" case so the component doesn't crash on double-fire.
 */
export async function autoSubmitExam(userId, examId, attemptId, answers) {
  try {
    return await submitExam(userId, examId, attemptId, answers)
  } catch (e) {
    if (isNotFoundError(e)) return null
    throw e
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _writeLocalSession(userId, examId, session) {
  try {
    localStorage.setItem(
      LS_KEY(userId, examId),
      JSON.stringify({ ...session, savedAt: Date.now() }),
    )
  } catch {}
}

// ── Exam attempt fetching (for results page) ──────────────────────────────────

export async function getExamAttempt(attemptId) {
  try {
    const snap = await getDoc(doc(db, 'exam_attempts', attemptId))
    if (!snap.exists()) return null
    return coerceAttempt({ id: snap.id, ...snap.data() })
  } catch (e) {
    console.error('getExamAttempt:', e)
    return null
  }
}

export async function getMyExamHistory(userId, limitCount = 10) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'exam_attempts'),
        where('userId', '==', userId),
        where('status', '==', 'submitted'),
        orderBy('submittedAt', 'desc'),
        limit(limitCount),
      ),
    )
    return snap.docs
      .map(d => coerceAttempt({ id: d.id, ...d.data() }))
      .filter(Boolean)
  } catch (e) {
    console.error('getMyExamHistory:', e)
    return []
  }
}
