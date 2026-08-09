/**
 * schemeReadiness — the pre-generation gate for the Scheme of Work (and
 * Weekly Forecast) studios. The smart preview card only lets a teacher press
 * Generate once every required piece of curriculum data is present, so the AI
 * never produces a mis-paced or mislabelled scheme.
 *
 * Required before generating:
 *   curriculum (cbc|obc) · grade · subject · term · teachingWeeks (from the
 *   calendar) · periodsPerWeek (from the framework, an attached timetable, or
 *   entered by hand).
 *
 * `hasSyllabus` is advisory only — a scheme can still be generated on general
 * curriculum knowledge, it just gets an "AI-inferred" provenance note.
 *
 * Pure + dependency-free so `node src/utils/schemeReadiness.test.js` runs it.
 */

import { curriculumLabel } from '../../../utils/schemeFormat.js'

/** The exact copy the brief specifies when a subject has no time allocation. */
export const MISSING_TIME_ALLOCATION_MESSAGE =
  'Time allocation for this subject is missing. Please update Curriculum Framework data or enter periods manually.'

function positive(n) {
  const v = Number(n)
  return Number.isFinite(v) && v > 0
}

function present(v) {
  return v !== undefined && v !== null && String(v).trim() !== ''
}

/**
 * @param {object} input
 * @returns {{ ready:boolean, missing:string[], messages:Array<{level:string,text:string}> }}
 *   `missing` is a list of field keys; `messages` are human-facing with a
 *   'error' (blocks generation) or 'info' (advisory) level.
 */
export function evaluate(input = {}) {
  const {
    curriculum,
    grade,
    subject,
    term,
    teachingWeeks,
    periodsPerWeek,
    hasSyllabus,
  } = input

  const missing = []
  const messages = []

  if (!present(curriculum)) {
    missing.push('curriculum')
    messages.push({ level: 'error', text: 'Choose a curriculum (CBC or OBC).' })
  }
  if (!present(grade)) {
    missing.push('grade')
    messages.push({ level: 'error', text: 'Select a grade.' })
  }
  if (!present(subject)) {
    missing.push('subject')
    messages.push({ level: 'error', text: 'Select a subject.' })
  }
  if (!positive(term)) {
    missing.push('term')
    messages.push({ level: 'error', text: 'Select a term.' })
  }
  if (!positive(teachingWeeks)) {
    missing.push('teachingWeeks')
    messages.push({
      level: 'error',
      text: 'Pick a year and term so the number of teaching weeks can be read from the School Calendar.',
    })
  }
  if (!positive(periodsPerWeek)) {
    missing.push('periodsPerWeek')
    messages.push({ level: 'error', text: MISSING_TIME_ALLOCATION_MESSAGE })
  }

  // Advisory (does not block): no official outline found for this pairing.
  if (missing.length === 0 && hasSyllabus === false) {
    messages.push({
      level: 'info',
      text: 'No Syllabi Studio outline was found for this grade + subject — the scheme will be built from general '
        + `${curriculumLabel(curriculum)} knowledge and tagged accordingly.`,
    })
  }

  return { ready: missing.length === 0, missing, messages }
}
