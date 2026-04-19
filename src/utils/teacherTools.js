/**
 * Client-side wrapper around the teacher-tools Cloud Functions.
 *
 * Mirrors the pattern used in src/utils/aiAssistant.js so error handling is
 * consistent across the app.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')

const generateLessonPlanCallable = httpsCallable(functions, 'generateLessonPlan', {
  timeout: 120_000, // server: 120s
})
const generateWorksheetCallable = httpsCallable(functions, 'generateWorksheet', {
  timeout: 120_000, // server: 120s
})
const generateFlashcardsCallable = httpsCallable(functions, 'generateFlashcards', {
  timeout: 90_000, // server: 90s
})
const generateSchemeOfWorkCallable = httpsCallable(functions, 'generateSchemeOfWork', {
  timeout: 180_000, // server: 180s — schemes are long
})
const generateRubricCallable = httpsCallable(functions, 'generateRubric', {
  timeout: 90_000, // server: 90s
})

export const TEACHER_GRADES = [
  { value: 'ECE', label: 'Early Childhood Education' },
  { value: 'G1', label: 'Grade 1' },
  { value: 'G2', label: 'Grade 2' },
  { value: 'G3', label: 'Grade 3' },
  { value: 'G4', label: 'Grade 4' },
  { value: 'G5', label: 'Grade 5' },
  { value: 'G6', label: 'Grade 6' },
  { value: 'G7', label: 'Grade 7' },
  { value: 'G8', label: 'Grade 8' },
  { value: 'G9', label: 'Grade 9' },
  { value: 'G10', label: 'Grade 10' },
  { value: 'G11', label: 'Grade 11' },
  { value: 'G12', label: 'Grade 12' },
]

export const TEACHER_SUBJECTS = [
  { value: 'mathematics', label: 'Mathematics' },
  { value: 'english', label: 'English' },
  { value: 'integrated_science', label: 'Integrated Science' },
  { value: 'social_studies', label: 'Social Studies' },
  { value: 'literacy', label: 'Literacy' },
  { value: 'zambian_language', label: 'Zambian Language' },
  { value: 'creative_and_technology_studies', label: 'Creative & Technology Studies' },
  { value: 'physical_education', label: 'Physical Education' },
  { value: 'religious_education', label: 'Religious Education' },
  { value: 'civic_education', label: 'Civic Education' },
  { value: 'biology', label: 'Biology' },
  { value: 'chemistry', label: 'Chemistry' },
  { value: 'physics', label: 'Physics' },
  { value: 'geography', label: 'Geography' },
  { value: 'history', label: 'History' },
]

export const TEACHER_LANGUAGES = [
  { value: 'english', label: 'English' },
  { value: 'bemba', label: 'Bemba' },
  { value: 'nyanja', label: 'Nyanja' },
  { value: 'tonga', label: 'Tonga' },
  { value: 'lozi', label: 'Lozi' },
  { value: 'kaonde', label: 'Kaonde' },
  { value: 'lunda', label: 'Lunda' },
  { value: 'luvale', label: 'Luvale' },
]

export const DURATION_PRESETS = [
  { value: 30, label: '30 min — short lesson' },
  { value: 40, label: '40 min — standard (recommended)' },
  { value: 60, label: '60 min — double period' },
  { value: 80, label: '80 min — extended' },
]

export const WORKSHEET_DIFFICULTIES = [
  { value: 'easy', label: 'Easy — recall and direct application' },
  { value: 'medium', label: 'Medium — one-step reasoning' },
  { value: 'hard', label: 'Hard — multi-step and word problems' },
  { value: 'mixed', label: 'Mixed — easy → hard progression (recommended)' },
]

export const WORKSHEET_QUESTION_COUNTS = [
  { value: 5, label: '5 questions — quick check' },
  { value: 10, label: '10 questions — standard (recommended)' },
  { value: 15, label: '15 questions — longer worksheet' },
  { value: 20, label: '20 questions — full test' },
]

export const WORKSHEET_DURATIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min (recommended)' },
  { value: 45, label: '45 min' },
  { value: 60, label: '60 min' },
]

export const FLASHCARD_COUNTS = [
  { value: 10, label: '10 cards — quick review' },
  { value: 15, label: '15 cards — standard (recommended)' },
  { value: 20, label: '20 cards — full topic' },
  { value: 30, label: '30 cards — deep revision' },
]

export const SCHEME_TERMS = [
  { value: 1, label: 'Term 1' },
  { value: 2, label: 'Term 2' },
  { value: 3, label: 'Term 3' },
]

export const SCHEME_WEEK_COUNTS = [
  { value: 10, label: '10 weeks' },
  { value: 12, label: '12 weeks (recommended)' },
  { value: 13, label: '13 weeks' },
  { value: 14, label: '14 weeks' },
]

export const RUBRIC_TASK_TYPES = [
  { value: 'essay',        label: 'Essay / composition' },
  { value: 'project',      label: 'Project' },
  { value: 'presentation', label: 'Oral presentation' },
  { value: 'practical',    label: 'Practical / experiment' },
  { value: 'oral',         label: 'Oral exam' },
  { value: 'performance',  label: 'Performance (drama / music / PE)' },
]

export const RUBRIC_TOTAL_MARKS = [
  { value: 10, label: '10 marks' },
  { value: 20, label: '20 marks (recommended)' },
  { value: 25, label: '25 marks' },
  { value: 40, label: '40 marks' },
  { value: 50, label: '50 marks' },
  { value: 100, label: '100 marks' },
]

export const RUBRIC_CRITERIA_COUNTS = [
  { value: 3, label: '3 criteria' },
  { value: 4, label: '4 criteria (recommended)' },
  { value: 5, label: '5 criteria' },
  { value: 6, label: '6 criteria' },
]

function messageFromError(error) {
  const code = error?.code || ''
  const detail = error?.message || ''
  if (code.includes('unauthenticated')) {
    return 'Please sign in to generate a lesson plan.'
  }
  if (code.includes('permission-denied')) {
    return 'Teacher tools are available to approved teachers only. Apply to become a verified teacher to continue.'
  }
  if (code.includes('not-found')) {
    return detail || 'That topic isn\'t in the syllabus yet. Try a different one.'
  }
  if (code.includes('failed-precondition')) {
    return detail || 'You have reached your monthly limit. Upgrade to continue.'
  }
  if (code.includes('resource-exhausted')) {
    return 'The AI is busy right now. Please wait a moment and try again.'
  }
  if (code.includes('invalid-argument')) {
    return detail || 'Please check your inputs and try again.'
  }
  return detail || 'The lesson plan generator is unavailable right now. Please try again.'
}

// Safety net — if the httpsCallable promise hasn't resolved in 130s, we
// reject with a clear message instead of leaving the spinner running forever.
// 130s > the 120s server timeout so the server's own error surfaces first when
// it's just slow; this only triggers on genuine client-side hangs (network,
// unreachable function, CORS misfire, etc.).
const HARD_CLIENT_TIMEOUT_MS = 130_000

function withTimeout(promise, ms, label = 'request') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const err = new Error(
        `Client-side timeout: ${label} did not respond within ${Math.round(ms / 1000)}s. ` +
        `This usually means the Cloud Function is not deployed or not reachable. ` +
        `Check: (1) 'firebase functions:list' includes generateLessonPlan, ` +
        `(2) ANTHROPIC_API_KEY secret is set, (3) you are signed in as a teacher/admin. ` +
        `See DEBUG_LESSON_PLAN.md.`
      )
      err.code = 'client-timeout'
      reject(err)
    }, ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export async function generateRubric(inputs) {
  console.info('[zedexams] generateRubric →', {
    grade: inputs?.grade, subject: inputs?.subject,
    taskType: inputs?.taskType, totalMarks: inputs?.totalMarks,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateRubricCallable(inputs),
      100_000,
      'generateRubric',
    )
    console.info(
      '[zedexams] generateRubric ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateRubric ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message, details: error?.details },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

export async function generateSchemeOfWork(inputs) {
  console.info('[zedexams] generateSchemeOfWork →', {
    grade: inputs?.grade, subject: inputs?.subject,
    term: inputs?.term, numberOfWeeks: inputs?.numberOfWeeks,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateSchemeOfWorkCallable(inputs),
      200_000, // a bit over the 180s server timeout
      'generateSchemeOfWork',
    )
    console.info(
      '[zedexams] generateSchemeOfWork ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateSchemeOfWork ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message, details: error?.details },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

export async function generateFlashcards(inputs) {
  console.info('[zedexams] generateFlashcards →', {
    grade: inputs?.grade, subject: inputs?.subject, topic: inputs?.topic,
    count: inputs?.count, difficulty: inputs?.difficulty,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateFlashcardsCallable(inputs),
      100_000, // generous: Haiku + small output, usually <20s
      'generateFlashcards',
    )
    console.info(
      '[zedexams] generateFlashcards ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateFlashcards ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message, details: error?.details },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

export async function generateWorksheet(inputs) {
  console.info('[zedexams] generateWorksheet →', {
    grade: inputs?.grade, subject: inputs?.subject, topic: inputs?.topic,
    count: inputs?.count, difficulty: inputs?.difficulty,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateWorksheetCallable(inputs),
      HARD_CLIENT_TIMEOUT_MS,
      'generateWorksheet',
    )
    console.info(
      '[zedexams] generateWorksheet ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateWorksheet ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message, details: error?.details },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

export async function generateLessonPlan(inputs) {
  // Log the outgoing request so it's visible in DevTools → Console.
  console.info('[zedexams] generateLessonPlan →', {
    grade: inputs?.grade,
    subject: inputs?.subject,
    topic: inputs?.topic,
    durationMinutes: inputs?.durationMinutes,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateLessonPlanCallable(inputs),
      HARD_CLIENT_TIMEOUT_MS,
      'generateLessonPlan',
    )
    console.info(
      '[zedexams] generateLessonPlan ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    // Verbose dev-console error so we can see exactly what failed.
    console.error('[zedexams] generateLessonPlan ← FAILED after',
      Date.now() - startedAt, 'ms',
      {
        code: error?.code,
        message: error?.message,
        details: error?.details,
        httpErrorCode: error?.httpErrorCode?.status,
      },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}
