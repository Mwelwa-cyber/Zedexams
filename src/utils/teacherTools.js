/**
 * Client-side wrapper around the teacher-tools Cloud Functions.
 *
 * Mirrors the pattern used in src/utils/aiAssistant.js so error handling is
 * consistent across the app.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { auth, getAppCheckToken } from '../firebase/config'
import { apiUrl, isNativePlatform } from './runtime'
import { LEARNING_ENVIRONMENTS } from '../config/learningEnvironments'
import { TEACHER_GRADES, TEACHER_SUBJECTS } from '../config/teacherTaxonomy'

// Re-exported so existing `import { TEACHER_GRADES } from './teacherTools'`
// callers keep working. The canonical definitions live in the pure,
// side-effect-free taxonomy module so they can be imported without firebase.
export { TEACHER_GRADES, TEACHER_SUBJECTS }

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
const generateNotesCallable = httpsCallable(functions, 'generateNotes', {
  timeout: 130_000, // server: 120s
})
const generateFullLessonCallable = httpsCallable(functions, 'generateFullLesson', {
  timeout: 130_000, // server: 120s
})
const generateHomeworkCallable = httpsCallable(functions, 'generateHomework', {
  timeout: 130_000, // server: 120s
})
const generateLessonActivitiesCallable = httpsCallable(functions, 'generateLessonActivities', {
  timeout: 185_000, // server: 180s — can produce a class exercise AND homework
})
const generateAssessmentCallable = httpsCallable(functions, 'generateAssessment', {
  timeout: 250_000, // server: 240s — big mocks stream for several minutes
})
const generateSbaTaskCallable = httpsCallable(functions, 'generateSbaTask', {
  timeout: 120_000, // server: 120s — single SBA task with its marking scheme
})
const generateQuizCallable = httpsCallable(functions, 'generateQuiz', {
  timeout: 130_000, // server: 120s
})
const generateExamPaperCallable = httpsCallable(functions, 'generateExamPaper', {
  timeout: 185_000, // server: 180s — up to 60 questions
})
const getTermModuleOutlineCallable = httpsCallable(functions, 'getTermModuleOutline', {
  timeout: 35_000, // server: 30s — a couple of small Firestore reads
})

// The grade-aware subject helpers + the ECE subject set live in the pure
// taxonomy module so plain `node` tests can exercise them without pulling in
// firebase/config. Re-exported here so existing
// `import { getSubjectsForGrade } from '../utils/teacherTools'` callers keep
// working.
export {
  ECE_GRADE_CODES,
  ECE_SUBJECTS,
  isEceGrade,
  getSubjectsForGrade,
  defaultSubjectForGrade,
  isSubjectValidForGrade,
} from '../config/teacherTaxonomy'

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

// Worksheet layout style. "auto" lets the AI pick from the topic; the rest
// force a specific layout on the server (see functions worksheetPrompt).
export const WORKSHEET_STYLES = [
  { value: 'auto', label: 'Auto — let the AI choose (recommended)' },
  { value: 'standard', label: 'Question & answer — numbered questions' },
  { value: 'grid', label: 'Practice grid — drills in columns (e.g. fractions → decimals)' },
  { value: 'comprehension', label: 'Reading comprehension — passage + questions' },
  { value: 'working', label: 'Show working — column maths (long division, multiplication)' },
  { value: 'matching', label: 'Matching — match items to an answer bank' },
  { value: 'word_problems', label: 'Word problems — real-life problems with working space' },
  { value: 'true_false', label: 'True or False — quick true/false drill' },
]

// Optional grid column override (only matters for grid/practice layouts).
export const WORKSHEET_GRID_COLUMNS = [
  { value: 0, label: 'Auto' },
  { value: 2, label: '2 columns' },
  { value: 3, label: '3 columns' },
  { value: 4, label: '4 columns' },
]

// Reading-passage length for comprehension worksheets.
export const WORKSHEET_PASSAGE_LENGTHS = [
  { value: '', label: 'Auto' },
  { value: 'short', label: 'Short — 3-4 sentences' },
  { value: 'medium', label: 'Medium — 6-8 sentences' },
  { value: 'long', label: 'Long — 10-14 sentences' },
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

// Optional curriculum-module selectors. Each list leads with a blank
// "not set" option so leaving them unselected keeps the generators on
// their previous (no-module) behaviour.
export const CURRICULUM_TERMS = [
  { value: '', label: '— Term (optional) —' },
  { value: '1', label: 'Term 1' },
  { value: '2', label: 'Term 2' },
  { value: '3', label: 'Term 3' },
]

export const LESSON_NUMBER_OPTIONS = [
  { value: '', label: '— Lesson number (optional) —' },
  ...Array.from({ length: 10 }, (_, i) => ({
    value: String(i + 1), label: `Lesson ${i + 1}`,
  })),
]

// How many lessons the teacher is splitting this sub-topic into. The stored
// curriculum module is per sub-topic; the teacher decides the split and the
// generator frames "Lesson N of M" so lessons don't repeat each other.
export const TOTAL_LESSONS_OPTIONS = [
  { value: '', label: '— How many lessons? (optional) —' },
  ...Array.from({ length: 10 }, (_, i) => ({
    value: String(i + 1), label: `${i + 1} lesson${i ? 's' : ''}`,
  })),
]

export const LEARNING_ENVIRONMENT_OPTIONS = [
  { value: '', label: '— Learning environment (optional) —' },
  ...LEARNING_ENVIRONMENTS.map((e) => ({ value: e.value, label: e.label })),
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
    promise
      .then((v) => { clearTimeout(t); resolve(v) })
      .catch((e) => { clearTimeout(t); reject(e) })
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

/**
 * Fetch the uploaded curriculum modules for a (grade, subject, term) as
 * official-scheme-shaped weeks, so the Weekly Forecast studio can build a
 * forecast straight from modules when the teacher has no saved scheme.
 * Returns { ok, data: { weeks, topicsCount, subtopicsCount } } or { ok:false }.
 */
export async function getTermModuleOutline({ grade, subject, term }) {
  try {
    const result = await withTimeout(
      getTermModuleOutlineCallable({ grade, subject, term }),
      40_000,
      'getTermModuleOutline',
    )
    return { ok: true, data: result.data }
  } catch (error) {
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
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

export async function generateNotes(inputs) {
  console.info('[zedexams] generateNotes →', {
    grade: inputs?.grade, subject: inputs?.subject, topic: inputs?.topic,
    lessonPlanId: inputs?.lessonPlanId || null,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateNotesCallable(inputs),
      HARD_CLIENT_TIMEOUT_MS,
      'generateNotes',
    )
    console.info(
      '[zedexams] generateNotes ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateNotes ← FAILED after',
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

/**
 * Streaming variants of the lesson-plan and worksheet generators.
 *
 * Hits the `apiGenerateLessonPlan` / `apiGenerateWorksheet` SSE endpoints,
 * which forward Anthropic's token deltas through as `progress` events and
 * deliver the parsed result on a final `result` event. The non-streaming
 * `generateLessonPlan` / `generateWorksheet` callables above remain the
 * canonical fallback path — Capacitor and DEV use them, since the SSE
 * ReadableStream is unreliable inside the Android WebView and is awkward
 * to point at the local Functions emulator.
 *
 * Callbacks:
 *   onProgress({phase, approxOutputTokens?, elapsedMs}) — fired periodically
 *     while the model is generating. `phase` ∈ "queued" | "claude_started" |
 *     "token" | "claude_done".
 *   onResult(data) — final parsed output ({lessonPlan|worksheet, generationId,
 *     usage, warning, kbGrounded}).
 *   onError(error) — terminal failure; nothing more will fire after this.
 *
 * Returns a `cancel()` function the caller invokes on unmount or
 * "stop generating" — cancellation aborts the fetch and skips remaining
 * callbacks. The server-side generation may still complete (and a quota
 * slot is still consumed), but the client stops reacting.
 */
export function generateLessonPlanStream(inputs, callbacks = {}) {
  return runStreamingGenerator({
    inputs,
    streamPath: '/api/teacher/lesson-plan/stream',
    callableFallback: generateLessonPlanCallable,
    resultKey: 'lessonPlan',
    label: 'generateLessonPlanStream',
    callbacks,
  })
}

export function generateWorksheetStream(inputs, callbacks = {}) {
  return runStreamingGenerator({
    inputs,
    streamPath: '/api/teacher/worksheet/stream',
    callableFallback: generateWorksheetCallable,
    resultKey: 'worksheet',
    label: 'generateWorksheetStream',
    callbacks,
  })
}

function runStreamingGenerator({
  inputs, streamPath, callableFallback, resultKey: _resultKey, label, callbacks,
}) {
  const { onProgress, onResult, onError } = callbacks
  let cancelled = false
  let abortController = null

  // DEV uses the Functions emulator (no hosting rewrite), and the Android
  // WebView buffers SSE in some versions. Both fall back to the existing
  // non-streaming callable — same business logic on the server, just no
  // live progress.
  if (import.meta.env.DEV || isNativePlatform()) {
    ;(async () => {
      try {
        onProgress?.({ phase: 'queued', elapsedMs: 0 })
        const result = await callableFallback(inputs)
        if (!cancelled) {
          onResult?.(result.data)
        }
      } catch (err) {
        if (!cancelled) {
          onError?.(new Error(messageFromError(err)))
        }
      }
    })()
    return () => { cancelled = true }
  }

  ;(async () => {
    let token
    try {
      token = await auth.currentUser?.getIdToken()
      if (!token) throw new Error('Please sign in before generating.')
    } catch (err) {
      onError?.(new Error(messageFromError(err)))
      return
    }

    abortController = new AbortController()
    const startedAt = Date.now()
    console.info(`[zedexams] ${label} → streaming`, {
      grade: inputs?.grade, subject: inputs?.subject, topic: inputs?.topic,
    })

    const appCheckToken = await getAppCheckToken()
    let response
    try {
      response = await fetch(apiUrl(streamPath), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
        },
        body: JSON.stringify(inputs || {}),
        signal: abortController.signal,
      })
    } catch (err) {
      if (cancelled) return
      // Network failure before any SSE bytes — fall back to the callable
      // so the user still gets their generation.
      console.warn(`[zedexams] ${label} fetch failed, falling back`, err?.message)
      try {
        const result = await callableFallback(inputs)
        if (!cancelled) onResult?.(result.data)
      } catch (fallbackErr) {
        if (!cancelled) onError?.(new Error(messageFromError(fallbackErr)))
      }
      return
    }

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}))
      if (!cancelled) {
        onError?.(new Error(data.error || 'Generation is unavailable right now. Please try again.'))
      }
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let resultDelivered = false

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done || cancelled) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw || raw === '[DONE]') continue
          if (raw.startsWith('[ERROR]')) {
            // Parse first, then throw outside the try — otherwise the
            // catch swallows our own throw and the server's real error
            // message ("AI is temporarily unavailable.", "permission-denied:
            // …", etc.) is replaced with the generic fallback.
            let serverError
            try {
              const payload = JSON.parse(raw.slice(7).trim())
              serverError = payload?.error
            } catch {
              /* keep serverError undefined → falls through to generic */
            }
            throw new Error(serverError || 'Generation failed. Please try again.')
          }
          let payload
          try { payload = JSON.parse(raw) } catch { continue }
          if (payload.type === 'progress') {
            onProgress?.(payload)
          } else if (payload.type === 'result') {
            resultDelivered = true
            const { type, ...data } = payload
            console.info(`[zedexams] ${label} ← ok in`, Date.now() - startedAt, 'ms', {
              generationId: data.generationId, warning: data.warning,
            })
            if (!cancelled) onResult?.(data)
          }
        }
      }
      if (!resultDelivered && !cancelled) {
        // Stream closed without a result event — treat as failure.
        onError?.(new Error('Generation ended unexpectedly. Please try again.'))
      }
    } catch (err) {
      if (cancelled) return
      console.error(`[zedexams] ${label} stream error after`, Date.now() - startedAt, 'ms', err?.message)
      onError?.(new Error(err?.message || 'Generation failed. Please try again.'))
    }
  })()

  return () => {
    cancelled = true
    try { abortController?.abort() } catch { /* ignore */ }
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

/**
 * Generate a complete, ready-to-deliver CBC lesson. Grounded on the stored
 * curriculum module when grade+subject+topic+sub-topic+term resolve one.
 */
export async function generateFullLesson(inputs) {
  console.info('[zedexams] generateFullLesson →', {
    grade: inputs?.grade,
    subject: inputs?.subject,
    topic: inputs?.topic,
    subtopic: inputs?.subtopic,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateFullLessonCallable(inputs),
      HARD_CLIENT_TIMEOUT_MS,
      'generateFullLesson',
    )
    console.info(
      '[zedexams] generateFullLesson ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning },
    )
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateFullLesson ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

/**
 * Generate short take-home homework. Grounded on the stored curriculum
 * module when grade+subject+topic+sub-topic+term resolve one.
 */
export async function generateHomework(inputs) {
  console.info('[zedexams] generateHomework →', {
    grade: inputs?.grade, subject: inputs?.subject,
    topic: inputs?.topic, subtopic: inputs?.subtopic,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateHomeworkCallable(inputs),
      HARD_CLIENT_TIMEOUT_MS,
      'generateHomework',
    )
    console.info('[zedexams] generateHomework ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning })
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateHomework ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

/**
 * Generate follow-up assessment activities (a class exercise and/or homework)
 * straight from a lesson in the Lesson Plan Studio. Grounded on the same
 * curriculum module the lesson plan used (grade + subject + topic + sub-topic).
 *
 * `inputs.activities` is 'exercise' | 'homework' | 'both'. Returns
 * { ok, data: { generationId, activities: { exercise, homework }, usage, warning } }.
 */
export async function generateLessonActivities(inputs) {
  console.info('[zedexams] generateLessonActivities →', {
    grade: inputs?.grade, subject: inputs?.subject,
    topic: inputs?.topic, activities: inputs?.activities,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateLessonActivitiesCallable(inputs),
      185_000,
      'generateLessonActivities',
    )
    console.info('[zedexams] generateLessonActivities ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning })
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateLessonActivities ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

/**
 * Generate a formal graded assessment. Grounded on the stored curriculum
 * module when grade+subject+topic+sub-topic+term resolve one. (Distinct
 * from the quiz-editor Assessment Studio — this is a saved, exportable
 * assessment document.)
 */
export async function generateAssessment(inputs) {
  console.info('[zedexams] generateAssessment →', {
    grade: inputs?.grade, subject: inputs?.subject,
    topic: inputs?.topic, subtopic: inputs?.subtopic,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateAssessmentCallable(inputs),
      // Big papers legitimately run past the shared 130s safety net; match
      // the callable's own 250s budget (server timeout is 240s).
      250_000,
      'generateAssessment',
    )
    console.info('[zedexams] generateAssessment ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning })
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateAssessment ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
      // Structured quota context (e.g. { reason: 'max-only' }) so studios can
      // route the right paywall — see functions/teacherTools/usageMeter.js.
      details: error?.details || null,
    }
  }
}

/**
 * Generate one ECZ-compliant School Based Assessment (SBA) task for an
 * upper-primary (Grade 5–7) subject + task type, with the marking artefact the
 * task type requires (answer key / oral observation / method marks / rubric).
 */
export async function generateSbaTask(inputs) {
  console.info('[zedexams] generateSbaTask →', {
    grade: inputs?.grade, subject: inputs?.subject,
    taskType: inputs?.taskType, component: inputs?.component,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateSbaTaskCallable(inputs),
      125_000,
      'generateSbaTask',
    )
    console.info('[zedexams] generateSbaTask ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning })
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateSbaTask ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

/**
 * Generate a short formative quiz. Grounded on the stored curriculum module
 * when grade+subject+topic+sub-topic+term resolve one. Distinct from the
 * quiz-editor / Vex subsystem — this is a saved, exportable quiz document.
 */
export async function generateQuiz(inputs) {
  console.info('[zedexams] generateQuiz →', {
    grade: inputs?.grade, subject: inputs?.subject,
    topic: inputs?.topic, subtopic: inputs?.subtopic,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateQuizCallable(inputs),
      HARD_CLIENT_TIMEOUT_MS,
      'generateQuiz',
    )
    console.info('[zedexams] generateQuiz ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning })
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateQuiz ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
    }
  }
}

// Exam papers can run to ~60 items, so allow longer than the shared 130s cap.
const EXAM_PAPER_CLIENT_TIMEOUT_MS = 190_000

/**
 * Generate fresh ECZ Grade 7 PSLE-style practice questions ("Exam Studio").
 * Grounded on the stored curriculum module when grade+subject(+topic) resolve
 * one. Returns { ok, data: { generationId, examPaper, usage, warning } }.
 */
export async function generateExamPaper(inputs) {
  console.info('[zedexams] generateExamPaper →', {
    grade: inputs?.grade, subject: inputs?.subject,
    topic: inputs?.topic, count: inputs?.count,
  })
  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      generateExamPaperCallable(inputs),
      EXAM_PAPER_CLIENT_TIMEOUT_MS,
      'generateExamPaper',
    )
    console.info('[zedexams] generateExamPaper ← ok in',
      Date.now() - startedAt, 'ms',
      { generationId: result?.data?.generationId, warning: result?.data?.warning })
    return { ok: true, data: result.data }
  } catch (error) {
    console.error('[zedexams] generateExamPaper ← FAILED after',
      Date.now() - startedAt, 'ms',
      { code: error?.code, message: error?.message },
    )
    return {
      ok: false,
      error: messageFromError(error),
      code: error?.code || 'unknown',
      rawMessage: error?.message || '',
      // Structured quota context (e.g. { reason: 'max-only' }) so studios can
      // route the right paywall — see functions/teacherTools/usageMeter.js.
      details: error?.details || null,
    }
  }
}
