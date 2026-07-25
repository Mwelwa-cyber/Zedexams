/**
 * The composite identity of a curriculum topic.
 *
 * A topic code is NOT globally unique and was never meant to be. The Ministry
 * numbers each syllabus from 1.1, so "1.1" only identifies a topic once you also
 * know which curriculum, which grade or form, and which subject you are in.
 * Commerce "1.1" and Principles of Accounts "1.1" are different topics; so are
 * Food & Nutrition "1.1" and Home Management "1.1".
 *
 * Everything that keys, groups, compares or looks up a topic must therefore use
 * the full four-part identity:
 *
 *     curriculumId + gradeId + subjectKey + topicCode
 *
 * This module is the single definition of that identity so the pickers, the
 * hierarchy repair, the AI grounding, the validation report and the migration
 * cannot drift into using three parts in one place and four in another.
 *
 * The visible topic codes are never rewritten. "1.1" stays "1.1" on the page and
 * in the export — the disambiguation lives in the internal identity only.
 *
 * Pure (no React, no Firebase, no I/O).
 */

/** Curriculum framework ids. `curriculumId` is the stable internal value. */
export const CURRICULUM_IDS = Object.freeze({ 2023: 'cbc', 2013: 'previous' })

/** '2023' | '2013' | 'cbc' | 'previous' → 'cbc' | 'previous' (default 'cbc'). */
export function normalizeCurriculumId(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === '2013' || raw === 'previous') return 'previous'
  return 'cbc'
}

function part(value) {
  return String(value ?? '').trim()
}

/**
 * The scope a topic code is unique within: curriculum + grade + subject.
 *
 * This is the unit the hierarchy repair may look for a parent in. A parent
 * lookup that crosses ANY of the three is wrong by construction — that is what
 * let a Home Management sub-topic fold under a Food & Nutrition topic.
 */
export function topicScopeKey({ curriculumId, gradeId, subjectKey }) {
  return [
    normalizeCurriculumId(curriculumId),
    part(gradeId).toUpperCase(),
    part(subjectKey).toLowerCase(),
  ].join('|')
}

/** The full four-part identity of one topic. */
export function topicIdentity({ curriculumId, gradeId, subjectKey, topicCode }) {
  return `${topicScopeKey({ curriculumId, gradeId, subjectKey })}|${part(topicCode)}`
}

/** Inverse of topicIdentity. Returns null for anything that isn't one. */
export function parseTopicIdentity(identity) {
  const parts = String(identity ?? '').split('|')
  if (parts.length !== 4) return null
  const [curriculumId, gradeId, subjectKey, topicCode] = parts
  if (!curriculumId || !gradeId || !subjectKey) return null
  return { curriculumId, gradeId, subjectKey, topicCode }
}

/**
 * The in-memory lookup key the topic pickers use.
 *
 * Historically "GRADE|subject", because each curriculum was loaded into its own
 * Map and the curriculum dimension was implicit in which Map you held. That is
 * still true, so the shape is unchanged — but it is built here now, once, so a
 * caller cannot quietly assemble a key that omits a dimension.
 */
export function lookupKey(gradeId, subjectKey) {
  return `${part(gradeId).toUpperCase()}|${part(subjectKey).toLowerCase()}`
}

/** Split a lookup key back into its grade and subject halves. */
export function parseLookupKey(key) {
  const [gradeId = '', subjectKey = ''] = String(key ?? '').split('|')
  return { gradeId, subjectKey }
}
