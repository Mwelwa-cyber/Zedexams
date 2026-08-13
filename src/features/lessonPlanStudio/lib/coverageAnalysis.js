/**
 * coverageAnalysis — pure helpers for the Lesson Plan Studio's "pacing &
 * coverage" panel: given the full syllabus for a grade+subject and the teacher's
 * saved lesson plans, work out which subtopics have been planned, the % covered,
 * the remaining gaps, and what to plan next.
 *
 * "Covered" here means *a saved lesson plan exists* for that subtopic — a
 * planning proxy, not proof it was taught. The UI says so; this module just does
 * the set maths.
 *
 * Pure ES module (no React / Firebase) so it unit-tests under plain node and the
 * matching logic stays in one tested place.
 *
 * Two coverage flavours share the same syllabus-pair maths:
 *   - computeCoverage      — legacy name-matching (kept for back-compat + tests)
 *   - computeCoverageByKey — matches the deterministic subtopic key the lesson
 *     memory (`lessonPlans`) records, so coverage and the per-subtopic Saved
 *     Lessons panel are driven by the SAME source and never disagree.
 */

import { buildSubtopicKey } from '../../../components/teacher/studio/utils/lessonMemory.js'

/** Lowercase + strip non-alphanumerics for tolerant comparison. */
function normName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Build the deduped, ordered list of {topic, subtopic} pairs from the syllabus
 * topics — the shared spine of both coverage calculators.
 */
function syllabusPairs(topics) {
  const pairs = []
  const seen = new Set()
  for (const t of Array.isArray(topics) ? topics : []) {
    const topicLabel = t && t.label ? String(t.label) : ''
    const subs = t && Array.isArray(t.subtopics) ? t.subtopics : []
    for (const sub of subs) {
      const label = String(sub == null ? '' : sub).trim()
      if (!label) continue
      const key = `${normName(topicLabel)}||${normName(label)}`
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({ topic: topicLabel, subtopic: label })
    }
  }
  return pairs
}

/** Reduce covered/uncovered pairs into the coverage summary the panel renders. */
function summarisePairs(pairs, currentTopicNorm) {
  const totalSubtopics = pairs.length
  const coveredCount = pairs.reduce((n, p) => (p.covered ? n + 1 : n), 0)
  const percent = totalSubtopics ? Math.round((coveredCount / totalSubtopics) * 100) : 0
  const gaps = pairs.filter((p) => !p.covered).map(({ topic, subtopic }) => ({ topic, subtopic }))
  let nextSuggestion = null
  if (gaps.length) {
    nextSuggestion = (currentTopicNorm && gaps.find((g) => normName(g.topic) === currentTopicNorm)) || gaps[0]
  }
  return { totalSubtopics, coveredCount, percent, gaps, nextSuggestion }
}

/**
 * Build the Set of (normalised) subtopic names the teacher has already planned
 * for a given grade+subject, from their saved lesson-plan generations.
 *
 * @param {Array<{inputs?: {grade?:string, subject?:string, subtopic?:string}}>} plans
 *        listMyGenerations({ tool: 'lesson_plan' }) output
 * @param {string} grade   current studio grade (e.g. "Grade 4")
 * @param {string} subject current studio subject key
 * @returns {Set<string>}
 */
export function coveredSubtopicSet(plans, grade, subject) {
  const set = new Set()
  if (!Array.isArray(plans)) return set
  const g = normName(grade)
  const s = normName(subject)
  for (const p of plans) {
    const inp = p && p.inputs
    if (!inp || !inp.subtopic) continue
    if (g && normName(inp.grade) !== g) continue
    if (s && normName(inp.subject) !== s) continue
    set.add(normName(inp.subtopic))
  }
  return set
}

/**
 * Compute coverage of the full syllabus against a set of covered subtopics.
 *
 * @param {Array<{label:string, subtopics:string[]}>} topics  getTopicsForSubject output
 * @param {Set<string>|string[]} coveredSubtopics  normalised covered names (from coveredSubtopicSet)
 * @param {{ currentTopic?: string }} [options]  prefer a gap under this topic for nextSuggestion
 * @returns {{
 *   totalSubtopics: number,
 *   coveredCount: number,
 *   percent: number,
 *   gaps: Array<{ topic: string, subtopic: string }>,
 *   nextSuggestion: { topic: string, subtopic: string } | null,
 * }}
 */
export function computeCoverage(topics, coveredSubtopics, options = {}) {
  const covered = coveredSubtopics instanceof Set
    ? coveredSubtopics
    : new Set(Array.isArray(coveredSubtopics) ? coveredSubtopics : [])
  const currentTopic = options.currentTopic != null ? normName(options.currentTopic) : null
  const pairs = syllabusPairs(topics).map((p) => ({ ...p, covered: covered.has(normName(p.subtopic)) }))
  return summarisePairs(pairs, currentTopic)
}

/**
 * Build the Set of subtopic KEYS the teacher has planned for a grade+subject,
 * read from their lesson memory (`lessonPlans`) records rather than the saved
 * library. Each record already carries the deterministic `subtopicKey` +
 * `gradeSubjectKey` (see utils/lessonMemory.js), so matching is exact — no
 * fragile name normalisation against syllabus labels.
 *
 * @param {Array<{subtopicKey?:string, gradeSubjectKey?:string, status?:string}>} plans
 * @param {string} gradeSubjectKey  buildGradeSubjectKey(...) for the selection
 * @returns {Set<string>}
 */
export function coveredSubtopicKeySet(plans, gradeSubjectKey) {
  const set = new Set()
  if (!Array.isArray(plans)) return set
  for (const p of plans) {
    if (!p || p.status === 'archived' || !p.subtopicKey) continue
    if (gradeSubjectKey && p.gradeSubjectKey !== gradeSubjectKey) continue
    set.add(p.subtopicKey)
  }
  return set
}

/**
 * Coverage of the full syllabus against a set of covered subtopic KEYS (from
 * coveredSubtopicKeySet). Each syllabus pair's key is rebuilt with the same
 * curriculum+grade+subject so it lines up with what the studio recorded.
 *
 * @param {Array<{label:string, subtopics:string[]}>} topics
 * @param {Set<string>|string[]} coveredKeys
 * @param {{ curriculumType?:string, grade?:string, subject?:string, currentTopic?:string }} [options]
 * @returns {{ totalSubtopics, coveredCount, percent, gaps, nextSuggestion }}
 */
export function computeCoverageByKey(topics, coveredKeys, options = {}) {
  const covered = coveredKeys instanceof Set
    ? coveredKeys
    : new Set(Array.isArray(coveredKeys) ? coveredKeys : [])
  const { curriculumType, grade, subject } = options
  const currentTopic = options.currentTopic != null ? normName(options.currentTopic) : null
  const pairs = syllabusPairs(topics).map((p) => ({
    ...p,
    covered: covered.has(buildSubtopicKey({ curriculumType, grade, subject, topic: p.topic, subtopic: p.subtopic })),
  }))
  return summarisePairs(pairs, currentTopic)
}
