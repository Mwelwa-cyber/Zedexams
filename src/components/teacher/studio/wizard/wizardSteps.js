/**
 * wizardSteps — pure step model + per-step validation for the Lesson Plan
 * Studio wizard. No React, no I/O: everything here is unit-testable with a
 * plain studioState-shaped object.
 *
 * The five steps mirror the studio's logical stages:
 *   0 Lesson Setup       — curriculum, class, subject, duration, date, …
 *   1 Topic & Curriculum — topic, subtopic, curriculum summary (+ outcomes
 *                          for the Previous curriculum)
 *   2 Lesson Context     — learning environment + planning mode (CBC only)
 *   3 Format & Options   — page budget, writing style, document format
 *   4 Review & Generate  — read-only summary + the Generate action
 *
 * Validation rules are the SAME rules the studio has always enforced via
 * computeIsValid (LessonPlanStudio.jsx), split per step, plus the wizard's
 * date requirement for step 0. computeIsValid remains the final generate
 * gate — these step checks only pace the teacher through the form.
 */

export const WIZARD_STEPS = [
  {
    id: 'setup',
    title: 'Lesson Setup',
    short: 'Setup',
    description: 'Choose your curriculum, class, subject and lesson details.',
  },
  {
    id: 'topic',
    title: 'Topic & Curriculum',
    short: 'Topic',
    description: 'Choose your topic and review curriculum details.',
  },
  {
    id: 'context',
    title: 'Lesson Context',
    short: 'Context',
    description: 'Set the learning environment and planning mode.',
  },
  {
    id: 'format',
    title: 'Format & Options',
    short: 'Format',
    description: 'Pick the page budget, writing style and document format.',
  },
  {
    id: 'review',
    title: 'Review & Generate',
    short: 'Review',
    description: 'Check everything, then generate your lesson plan.',
  },
]

export const WIZARD_STEP_COUNT = WIZARD_STEPS.length
export const REVIEW_STEP = WIZARD_STEP_COUNT - 1

/** Clamp any value to a valid step index (0 … 4). */
export function clampStep(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(Math.trunc(n), 0), WIZARD_STEP_COUNT - 1)
}

const VALID = { valid: true, reason: null, fieldId: null }

function invalid(reason, fieldId = null) {
  return { valid: false, reason, fieldId }
}

/**
 * Validate one step against the current studio state.
 *
 * @param {number} stepIndex 0-based wizard step
 * @param {object} s a studioState-shaped object ({ curriculumMode,
 *   lessonDetails, topicData, selectedOutcomes, learningEnvironments,
 *   lessonSeries, lessonBreakdown, formatOptions })
 * @returns {{ valid: boolean, reason: string|null, fieldId: string|null }}
 *   `reason` is teacher-readable ("Select a subject to continue.");
 *   `fieldId` is the DOM id of the first invalid control, for focusing.
 */
export function validateStep(stepIndex, s) {
  if (!s) return invalid('Something went wrong. Reload the page to continue.')
  const step = clampStep(stepIndex)
  const details = s.lessonDetails ?? {}
  const topic = s.topicData ?? {}
  const mode = s.curriculumMode

  if (step === 0) {
    if (!mode) return invalid('Choose a curriculum to continue.', 'lpw-curriculum-cbc')
    if (!details.grade) return invalid('Select a class to continue.', 'ldf-grade')
    if (!details.subject) return invalid('Select a subject to continue.', 'ldf-subject')
    if (!details.duration) return invalid('Choose a lesson duration to continue.', 'ldf-duration')
    if (!details.date) return invalid('Pick the lesson date to continue.', 'ldf-date')
    return VALID
  }

  if (step === 1) {
    if (!topic.topic) return invalid('Select a topic to continue.', 'tsf-topic')
    if (!topic.subtopic) return invalid('Select a subtopic to continue.', 'tsf-subtopic')
    if (mode === 'cbc' && !topic.subtopicRow?.specificCompetence) {
      return invalid('Curriculum details are still loading — one moment.', 'tsf-subtopic')
    }
    if (mode === 'previous' && !(s.selectedOutcomes?.length > 0)) {
      return invalid('Select at least one specific outcome to continue.', 'sof-outcomes')
    }
    return VALID
  }

  if (step === 2) {
    if (mode !== 'cbc') return VALID // Previous curriculum has no context settings
    if (!(s.learningEnvironments?.length > 0)) {
      return invalid('Choose at least one learning environment.', 'lpw-env-natural')
    }
    const planningMode = s.lessonSeries?.planningMode ?? 'single'
    if (planningMode === 'series' && !(s.lessonBreakdown?.length > 0)) {
      return invalid('Build your lesson series (or switch to Single Lesson) to continue.', 'lpf-count')
    }
    return VALID
  }

  if (step === 3) {
    const fmt = s.formatOptions ?? {}
    // §2.1 — Page Budget replaced Detail Level. Validating the retired field
    // would block every teacher on this step forever, so the check moves with
    // the control it guards.
    if (!fmt.pageBudget) return invalid('Choose a page budget to continue.')
    if (!fmt.writingStyle) return invalid('Choose a writing style to continue.')
    if (!fmt.format) return invalid('Choose a lesson plan format to continue.')
    return VALID
  }

  // Review: valid only when every earlier step is valid.
  const firstBad = firstInvalidStep(s)
  if (firstBad !== -1 && firstBad < REVIEW_STEP) {
    const bad = validateStep(firstBad, s)
    return invalid(bad.reason, bad.fieldId)
  }
  return VALID
}

/**
 * Index of the first invalid step BEFORE the review step, or -1 when
 * steps 0–3 are all valid.
 */
export function firstInvalidStep(s) {
  for (let i = 0; i < REVIEW_STEP; i++) {
    if (!validateStep(i, s).valid) return i
  }
  return -1
}

/**
 * The furthest step the teacher may navigate to: one past the last
 * consecutive valid step (so the step being worked on is always reachable,
 * and Review unlocks once steps 0–3 all pass).
 */
export function maxReachableStep(s) {
  const firstBad = firstInvalidStep(s)
  return firstBad === -1 ? REVIEW_STEP : firstBad
}

/** True when every pre-review step passes — i.e. Review is unlocked. */
export function allStepsValid(s) {
  return firstInvalidStep(s) === -1
}
