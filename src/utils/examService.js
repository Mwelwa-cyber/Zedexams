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
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { buildQuizDisplaySections } from './quizSections'
import { coerceQuiz } from '../schemas/quiz.js'
import { attemptStartSchema, coerceAttempt } from '../schemas/attempt.js'

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
 * Defensive shape rules: quiz.passages is coerced to an array before it
 * touches buildQuizDisplaySections (which already coerces internally — this
 * is belt-and-braces so a future caller can't accidentally re-introduce the
 * "s.forEach is not a function" crash that bit /exam/:id loaders).
 */
export async function getExamWithQuestions(examId) {
  const [quizSnap, qSnap] = await Promise.all([
    getDoc(doc(db, 'quizzes', examId)),
    getDocs(
      query(
        collection(db, 'quizzes', examId, 'questions'),
        orderBy('order', 'asc'),
      ),
    ),
  ])

  if (!quizSnap.exists()) return null

  // Normalise the quiz at the read boundary. coerceQuiz guarantees
  // `passages` and `parts` are well-shaped arrays, so the downstream
  // builder + every UI reader can stop branching defensively. The local
  // `Array.isArray(quiz.passages)` guard below is left in place for now
  // as a second line of defence; safe to remove once every reader is on
  // coerceQuiz.
  const quiz = coerceQuiz({ id: quizSnap.id, ...quizSnap.data() })
  const questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
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
    return { id: d.id, ...d.data() }
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

  // If the deadline already passed, auto-submit with whatever was saved
  if (Date.now() >= attempt.endTime) {
    // Fetch the real questions so partial answers still score. The previous
    // version passed `attempt.answers || []` as the questions argument, but
    // `attempt.answers` is `{}` (an object, not an array). _doSubmit then
    // ran `questions.forEach(...)` on an object and crashed with
    // `forEach is not a function`, blanking the page into the
    // ErrorBoundary whenever a learner revisited an expired-but-not-yet-
    // submitted attempt.
    let questions = []
    try {
      const qSnap = await getDocs(
        query(
          collection(db, 'quizzes', attempt.examId, 'questions'),
          orderBy('order', 'asc'),
        ),
      )
      questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    } catch (e) {
      console.error('restoreExam questions read for auto-submit failed:', e)
      // Fall through with []; _doSubmit handles that by falling back to
      // `attempt.totalMarks` and produces a 0-score submission rather than
      // throwing.
    }
    await _doSubmit(attemptId, attempt, questions, attempt.answers || {})
    await _updateLockStatus(userId, attempt.subject, 'submitted')
    localStorage.removeItem(LS_KEY(userId, attempt.examId))
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
 * Submit the exam: calculate score, write to Firestore, clear local state.
 * questions is the flat array of question objects (with id, correctAnswer, marks).
 * answers is { [questionId]: value }.
 */
export async function submitExam(userId, attemptId, questions, answers) {
  const snap = await getDoc(doc(db, 'exam_attempts', attemptId))
  if (!snap.exists()) throw new Error('Attempt not found.')

  const attempt = snap.data()
  if (attempt.status === 'submitted') {
    return { alreadySubmitted: true, attemptId }
  }

  const result = await _doSubmit(attemptId, attempt, questions, answers)
  await _updateLockStatus(userId, attempt.subject, 'submitted')
  localStorage.removeItem(LS_KEY(userId, attempt.examId))

  return result
}

/**
 * Auto-submit when the timer fires — same as submitExam but swallows the
 * "already submitted" case so the component doesn't crash on double-fire.
 */
export async function autoSubmitExam(userId, attemptId, questions, answers) {
  try {
    return await submitExam(userId, attemptId, questions, answers)
  } catch (e) {
    if (e.message === 'Attempt not found.') return null
    throw e
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function _doSubmit(attemptId, attempt, questions, answers) {
  // Defensive coercion — see restoreExam where a wrong-shape `questions`
  // arg used to take down the runner with `forEach is not a function`.
  // _doSubmit already falls back to attempt.totalMarks / totalQuestions
  // when the array is empty, so a non-array input degrades to a 0-score
  // submission rather than blanking the page.
  const safeQuestions = Array.isArray(questions) ? questions : []
  let score = 0
  let totalMarks = 0
  const topicBreakdown = {}

  safeQuestions.forEach(q => {
    const marks   = q.marks ?? 1
    const topic   = (q.topic || 'General').trim()
    totalMarks   += marks

    const isText  = q.type === 'short_answer' || q.type === 'diagram'
    const given   = answers[q.id]
    const correct = isText ? given?.correct === true : given === q.correctAnswer
    if (correct) score += marks

    if (!topicBreakdown[topic]) topicBreakdown[topic] = { correct: 0, total: 0, marks: 0, totalMarks: 0 }
    topicBreakdown[topic].total    += 1
    topicBreakdown[topic].totalMarks += marks
    if (correct) {
      topicBreakdown[topic].correct += 1
      topicBreakdown[topic].marks   += marks
    }
  })

  // Compute percentage per topic
  Object.values(topicBreakdown).forEach(t => {
    t.percentage = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0
  })

  // Fall back to stored totalMarks if questions array was empty
  if (totalMarks === 0) totalMarks = attempt.totalMarks || 0

  const totalQuestions = safeQuestions.length || attempt.totalQuestions || 0
  const percentage     = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0
  const startMs        = attempt.startedAt?.toMillis?.() ?? (Date.now() - 60_000)
  const timeTakenSeconds = Math.round((Date.now() - startMs) / 1000)

  // Strengths ≥ 70 %, weaknesses < 50 %
  const strengths  = Object.entries(topicBreakdown).filter(([, t]) => t.percentage >= 70).map(([k]) => k)
  const weaknesses = Object.entries(topicBreakdown).filter(([, t]) => t.percentage <  50).map(([k]) => k)

  const performanceLevel =
    percentage >= 90 ? 'Excellent'
    : percentage >= 75 ? 'Very Good'
    : percentage >= 60 ? 'Good'
    : percentage >= 50 ? 'Developing'
    : 'Needs Improvement'

  // CBC-aligned feedback (plain text, learner-friendly)
  const feedbackCan = strengths.length > 0
    ? `You can work confidently with ${_listify(strengths)}.`
    : 'You are building your skills across all topics in this exam.'

  const feedbackDeveloping = weaknesses.length > 0
    ? `You are still developing your understanding of ${_listify(weaknesses)}.`
    : 'You showed a solid understanding across all the topics covered.'

  const feedbackPractice = weaknesses.length > 0
    ? `Practise more questions on ${_listify(weaknesses)} to strengthen these areas.`
    : 'Keep up the excellent work — try another exam to maintain your performance!'

  await updateDoc(doc(db, 'exam_attempts', attemptId), {
    status: 'submitted',
    answers,
    score,
    totalMarks,
    totalQuestions,
    percentage,
    timeTakenSeconds,
    submittedAt: serverTimestamp(),
    // topic analysis (private to the learner — only they read their own attempt detail)
    topicBreakdown,
    strengths,
    weaknesses,
    performanceLevel,
    feedback: { can: feedbackCan, developing: feedbackDeveloping, practice: feedbackPractice },
  })

  return { score, totalMarks, totalQuestions, percentage, timeTakenSeconds, attemptId,
           topicBreakdown, strengths, weaknesses, performanceLevel,
           feedback: { can: feedbackCan, developing: feedbackDeveloping, practice: feedbackPractice } }
}

function _listify(arr) {
  if (arr.length === 0) return ''
  if (arr.length === 1) return arr[0]
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]
}

async function _updateLockStatus(userId, subject, status) {
  try {
    await updateDoc(doc(db, 'daily_exam_locks', lockId(userId, subject)), { status })
  } catch {}
}

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
