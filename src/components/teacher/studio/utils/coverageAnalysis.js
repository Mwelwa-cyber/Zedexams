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
 */

/** Lowercase + strip non-alphanumerics for tolerant comparison. */
function normName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '')
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
      pairs.push({ topic: topicLabel, subtopic: label, covered: covered.has(normName(label)) })
    }
  }

  const totalSubtopics = pairs.length
  const coveredCount = pairs.reduce((n, p) => (p.covered ? n + 1 : n), 0)
  const percent = totalSubtopics ? Math.round((coveredCount / totalSubtopics) * 100) : 0
  const gaps = pairs.filter((p) => !p.covered).map(({ topic, subtopic }) => ({ topic, subtopic }))

  let nextSuggestion = null
  if (gaps.length) {
    nextSuggestion =
      (currentTopic && gaps.find((g) => normName(g.topic) === currentTopic)) || gaps[0]
  }

  return { totalSubtopics, coveredCount, percent, gaps, nextSuggestion }
}
