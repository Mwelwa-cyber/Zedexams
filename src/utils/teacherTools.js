/**
 * Client-side wrapper around the teacher-tools Cloud Functions.
 *
 * Mirrors the pattern used in src/utils/aiAssistant.js so error handling is
 * consistent across the app.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { auth } from '../firebase/config'
import { apiUrl, isNativePlatform } from './runtime'
import { LEARNING_ENVIRONMENTS } from '../config/learningEnvironments'

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

// Grades grouped by Zambia CBC phase. Values use the canonical G-prefix the
// backend's ALLOWED_GRADES accepts (ECE, G1–G12). Labels show the
// "Grade 8 / Form 1" dual naming so secondary teachers still recognise them.
//
// Items with `group` (no `value`) render as <optgroup> labels in FieldSelect.
export const TEACHER_GRADES = [
  { group: 'Pre-Primary' },
  { value: 'ECE', label: 'ECE — Early Childhood Education' },
  { group: 'Lower Primary (Grades 1–4)' },
  { value: 'G1', label: 'Grade 1' },
  { value: 'G2', label: 'Grade 2' },
  { value: 'G3', label: 'Grade 3' },
  { value: 'G4', label: 'Grade 4' },
  { group: 'Upper Primary (Grades 5–7)' },
  { value: 'G5', label: 'Grade 5' },
  { value: 'G6', label: 'Grade 6' },
  { value: 'G7', label: 'Grade 7' },
  { group: 'Junior Secondary (Grades 8–9)' },
  { value: 'G8', label: 'Grade 8 / Form 1' },
  { value: 'G9', label: 'Grade 9 / Form 2' },
  { group: 'Senior Secondary (Grades 10–12)' },
  { value: 'G10', label: 'Grade 10 / Form 3' },
  { value: 'G11', label: 'Grade 11 / Form 4' },
  { value: 'G12', label: 'Grade 12 / Form 5' },
]

// Subjects grouped by curriculum area across all CBC phases.
export const TEACHER_SUBJECTS = [
  { group: 'Languages' },
  { value: 'english',          label: 'English' },
  { value: 'literacy',         label: 'Literacy' },
  { value: 'cinyanja',         label: 'Cinyanja' },
  { value: 'zambian_language', label: 'Zambian Language (other)' },
  { group: 'STEM' },
  { value: 'mathematics',          label: 'Mathematics' },
  { value: 'numeracy',             label: 'Numeracy' },
  { value: 'integrated_science',   label: 'Integrated Science' },
  { value: 'environmental_science',label: 'Environmental Science' },
  { value: 'biology',              label: 'Biology' },
  { value: 'chemistry',            label: 'Chemistry' },
  { value: 'physics',              label: 'Physics' },
  { group: 'Humanities' },
  { value: 'social_studies',   label: 'Social Studies' },
  { value: 'history',          label: 'History' },
  { value: 'geography',        label: 'Geography' },
  { value: 'civic_education',  label: 'Civic Education' },
  { value: 'religious_education', label: 'Religious Education' },
  { group: 'Technical & Creative' },
  { value: 'technology_studies',              label: 'Technology Studies' },
  { value: 'creative_and_technology_studies', label: 'Creative & Technology Studies' },
  { value: 'home_economics',   label: 'Home Economics' },
  { value: 'expressive_arts',  label: 'Expressive Arts' },
  { value: 'physical_education', label: 'Physical Education' },
]

// Maps each subject value to the grades it's actually taught at in the
// Zambian CBC. Used by getSubjectsForGrade() to filter the dropdown so
// teachers only see pedagogically valid combinations (no Biology for
// Grade 1, no Literacy for Grade 12).
const SUBJECT_GRADE_MAP = {
  // Languages — English & Zambian Language span everything; Literacy is
  // the lower-primary reading-and-writing strand that gives way to English.
  english:           ['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  literacy:          ['ECE','G1','G2','G3','G4'],
  cinyanja:          ['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  zambian_language:  ['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],

  // STEM — Numeracy is the early-grade pre-Mathematics strand. Integrated
  // Science covers all primary + junior secondary, then splits into
  // Bio/Chem/Phys at senior secondary.
  mathematics:       ['G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
  numeracy:          ['ECE','G1','G2','G3','G4'],
  integrated_science:['G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  environmental_science: ['G1','G2','G3','G4'],
  biology:           ['G10','G11','G12'],
  chemistry:         ['G10','G11','G12'],
  physics:           ['G10','G11','G12'],

  // Humanities — Social Studies covers ECE through junior secondary; in
  // senior secondary it splits into History/Geography/Civic Education.
  social_studies:    ['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  history:           ['G8','G9','G10','G11','G12'],
  geography:         ['G8','G9','G10','G11','G12'],
  civic_education:   ['G5','G6','G7','G8','G9','G10','G11','G12'],
  religious_education:['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],

  // Technical & creative — Creative & Technology Studies is the primary-
  // level integrated subject; Technology Studies and Home Economics take
  // over from upper primary onwards. Expressive Arts runs ECE–junior.
  technology_studies:['G5','G6','G7','G8','G9','G10','G11','G12'],
  creative_and_technology_studies: ['G1','G2','G3','G4','G5','G6','G7'],
  home_economics:    ['G5','G6','G7','G8','G9','G10','G11','G12'],
  expressive_arts:   ['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9'],
  physical_education:['ECE','G1','G2','G3','G4','G5','G6','G7','G8','G9','G10','G11','G12'],
}

/**
 * Returns the TEACHER_SUBJECTS list filtered to the subjects taught at
 * the given grade. Group headers are kept only if at least one subject in
 * that group survives the filter. Falls back to the full list if grade is
 * unknown (e.g. legacy URL deeplink).
 */
export function getSubjectsForGrade(grade) {
  if (!grade) return TEACHER_SUBJECTS
  const filtered = []
  let pendingGroup = null
  let groupHasItems = false
  for (const opt of TEACHER_SUBJECTS) {
    if (opt.group !== undefined) {
      pendingGroup = opt
      groupHasItems = false
      continue
    }
    const grades = SUBJECT_GRADE_MAP[opt.value]
    const allowed = !grades || grades.includes(grade)
    if (!allowed) continue
    if (pendingGroup && !groupHasItems) {
      filtered.push(pendingGroup)
      groupHasItems = true
    }
    filtered.push(opt)
  }
  // Defensive: never return an empty list. If a future grade has no
  // subject mappings at all, fall back to the full list rather than
  // showing an empty dropdown.
  return filtered.length > 0 ? filtered : TEACHER_SUBJECTS
}

/**
 * Picks a sensible default subject for a grade — used when the grade
 * changes and the previously-selected subject no longer applies.
 * Returns the first non-group option from getSubjectsForGrade().
 */
export function defaultSubjectForGrade(grade) {
  const opts = getSubjectsForGrade(grade)
  const firstSubject = opts.find((o) => o.value !== undefined)
  return firstSubject?.value || 'mathematics'
}

/**
 * True if `subject` is taught at `grade` according to SUBJECT_GRADE_MAP.
 * Subjects with no mapping entry default to true (forward-compatible).
 */
export function isSubjectValidForGrade(subject, grade) {
  const grades = SUBJECT_GRADE_MAP[subject]
  if (!grades) return true
  return grades.includes(grade)
}

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

    let response
    try {
      response = await fetch(apiUrl(streamPath), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
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
            try {
              const { error } = JSON.parse(raw.slice(7).trim())
              throw new Error(error || 'Generation failed.')
            } catch (parseErr) {
              throw new Error('Generation failed. Please try again.')
            }
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
