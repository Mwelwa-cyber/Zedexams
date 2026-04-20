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

  const quiz = { id: quizSnap.id, ...quizSnap.data() }
  const questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const { sections } = buildQuizDisplaySections(questions, quiz.passages || [])

  return { quiz, questions, sections }
}

/**
 * Return today's daily exam quiz for a given subject + grade, or null if none.
 * A quiz qualifies when: isDailyExam == true, dailyExamDate == today,
 * subject matches, and isPublished == true.
 */
export async function getTodaysExam(subject, grade) {
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

  const attemptRef = await addDoc(collection(db, 'exam_attempts'), {
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

  const attempt = snap.data()

  if (attempt.status === 'submitted') {
    return { alreadySubmitted: true, attemptId }
  }

  // If the deadline already passed, auto-submit with whatever was saved
  if (Date.now() >= attempt.endTime) {
    await _doSubmit(attemptId, attempt, attempt.answers || [], attempt.answers || {})
    await _updateLockStatus(userId, attempt.subject, 'submitted')
    localStorage.removeItem(LS_KEY(userId, attempt.examId))
    return { alreadySubmitted: true, attemptId, timeExpired: true }
  }

  const session = {
    attemptId,
    examId: attempt.examId,
    endTime: attempt.endTime, // Firestore is authoritative
    answers: attempt.answers || {},
    flagged: attempt.flagged || [],
    currentSectionIndex: attempt.currentSectionIndex || 0,
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
  let score = 0
  let totalMarks = 0

  questions.forEach(q => {
    const marks = q.marks ?? 1
    totalMarks += marks
    const isText = q.type === 'short_answer' || q.type === 'diagram'
    const given = answers[q.id]
    const correct = isText
      ? given?.correct === true
      : given === q.correctAnswer
    if (correct) score += marks
  })

  // Fall back to the stored totalMarks if questions array was empty
  if (totalMarks === 0) totalMarks = attempt.totalMarks || 0

  const percentage = totalMarks > 0 ? Math.round((score / totalMarks) * 100) : 0
  const startMs = attempt.startedAt?.toMillis?.() ?? (Date.now() - 60_000)
  const timeTakenSeconds = Math.round((Date.now() - startMs) / 1000)

  await updateDoc(doc(db, 'exam_attempts', attemptId), {
    status: 'submitted',
    answers,
    score,
    totalMarks,
    percentage,
    timeTakenSeconds,
    submittedAt: serverTimestamp(),
  })

  return { score, totalMarks, percentage, timeTakenSeconds, attemptId }
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
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
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
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.error('getMyExamHistory:', e)
    return []
  }
}
