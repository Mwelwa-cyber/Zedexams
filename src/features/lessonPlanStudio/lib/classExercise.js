/**
 * classExercise — the teacher's request for a class exercise in the lesson plan.
 *
 * Pure and framework-free (node-tested in classExercise.test.js). The request
 * lives on `formatOptions.classExercise = { include, details }`, so it persists
 * with the studio draft and is part of the idempotency fingerprint, and it
 * reaches the model only as prompt lines built here.
 *
 * Why the two curricula differ: the CBC plan already has an EXERCISE /
 * ASSESSMENT stage, so the exercise goes there. The 2013 (OBC) plan has exactly
 * INTRODUCTION → DEVELOPMENT → CONCLUSION and no stage to put it in, so a
 * requested exercise adds one clearly named stage. Nothing changes when the
 * teacher has not asked for one.
 */

export const CLASS_EXERCISE_STAGE_NAME = 'CLASS EXERCISE'
export const CLASS_EXERCISE_MAX_DETAILS = 600

// The plan renderer strips bare "1." / "1)" prefixes from every cell line, so
// numbered questions would print as unnumbered dashes. "Question 1:" survives.
const LABEL_RULE =
  'Start each question or task with "Question 1:", "Question 2:" and so on — never a bare "1." or "1)", which would be lost when the plan is printed.'

// Applied when the teacher ticks the box but writes nothing: a sensible default
// rather than an empty request.
const DEFAULT_EXERCISE_BRIEF =
  'Write a short written exercise of about 5 questions or tasks pitched at the lesson\'s specific outcome(s).'

/**
 * Read the request defensively. Drafts saved before this field existed have no
 * `classExercise`, and a restored draft may carry anything.
 *
 * @returns {{ include: boolean, details: string }}
 */
export function resolveClassExercise(formatOptions) {
  const raw = formatOptions && typeof formatOptions === 'object' ? formatOptions.classExercise : null
  if (!raw || typeof raw !== 'object') return { include: false, details: '' }
  return {
    include: raw.include === true,
    details: cleanDetails(raw.details),
  }
}

/**
 * Teacher-typed text goes into the prompt, so keep it to plain text: no control
 * characters, no run of blank lines, and nothing that could close the tag it is
 * wrapped in.
 */
export function cleanDetails(value) {
  const text = typeof value === 'string' ? value : ''
  return text
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/<\/?\s*class_exercise[^>]*>/gi, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CLASS_EXERCISE_MAX_DETAILS)
    .trim()
}

/** Prompt lines for the user prompt. Empty when no exercise was requested. */
export function classExercisePromptLines(curriculumMode, request) {
  const { include, details } = request || {}
  if (!include) return []

  const brief = details
    ? [
      'The teacher\'s class exercise (use their questions or tasks as given — complete, number or tidy them, do not replace them):',
      '<class_exercise>',
      details,
      '</class_exercise>',
    ]
    : [DEFAULT_EXERCISE_BRIEF]

  if (curriculumMode === 'previous') {
    return [
      '',
      `- CLASS EXERCISE REQUESTED: add exactly ONE extra stage named "${CLASS_EXERCISE_STAGE_NAME}" between DEVELOPMENT and CONCLUSION, so the stages are INTRODUCTION → DEVELOPMENT → ${CLASS_EXERCISE_STAGE_NAME} → CONCLUSION. Pupils' Activities in that stage ARE the exercise: write out the actual questions or tasks, with expected answers in brackets. Assessment Criteria say how it is marked. Stage durations must still add up to the lesson duration. ${LABEL_RULE}`,
      ...brief,
    ]
  }

  return [
    '',
    '- CLASS EXERCISE REQUESTED: put the class exercise in the EXERCISE / ASSESSMENT stage. Learners\' Activities in that stage ARE the exercise: write out the actual questions or tasks, with expected answers in brackets. Assessment Criteria say how it is marked. ' + LABEL_RULE,
    ...brief,
  ]
}
