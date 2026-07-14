/**
 * freePreview — pure output-shaping for Free-plan previews (dashboard
 * redesign §12–13).
 *
 * The generators clamp their INPUTS for free teachers (marks budget, week
 * count) so the model aims small, but a model can overshoot — these helpers
 * are the hard guarantee applied to the OUTPUT before it is persisted or
 * returned. Fail-closed on the revenue boundary: when in doubt they cut
 * down, never up, and a malformed artifact passes through untouched rather
 * than being corrupted.
 *
 * Pure + dependency-free so it tests under plain `node`
 * (freePreview.test.js), per the *Core.js rule in AI_DEVELOPMENT_GUIDE.md.
 */

/**
 * Truncate an assessment to at most `maxQuestions` across its sections, in
 * document order. Emptied sections are dropped, and header totals are
 * restamped from the questions that remain so the preview never claims
 * marks it doesn't contain. Returns { assessment, truncated }.
 */
function clampAssessmentPreview(assessment, maxQuestions) {
  const max = Number(maxQuestions)
  if (!assessment || !Array.isArray(assessment.sections) || !Number.isFinite(max) || max < 1) {
    return { assessment, truncated: false }
  }
  let remaining = max
  let kept = 0
  let marks = 0
  const sections = []
  for (const section of assessment.sections) {
    const questions = Array.isArray(section?.questions) ? section.questions : []
    const take = questions.slice(0, Math.max(0, remaining))
    remaining -= take.length
    kept += take.length
    for (const q of take) {
      const m = Number(q?.marks)
      if (Number.isFinite(m) && m > 0) marks += m
    }
    if (take.length > 0) sections.push({ ...section, questions: take })
  }
  const total = assessment.sections.reduce(
    (n, s) => n + (Array.isArray(s?.questions) ? s.questions.length : 0), 0,
  )
  if (kept >= total) return { assessment, truncated: false }
  const out = { ...assessment, sections }
  if (out.header && typeof out.header === 'object' && marks > 0) {
    out.header = { ...out.header, totalMarks: marks }
  }
  return { assessment: out, truncated: true }
}

/**
 * Truncate a Scheme of Work to its first `maxWeeks` weeks and restamp the
 * header's week count. Returns { scheme, truncated }.
 */
function clampSchemePreview(scheme, maxWeeks) {
  const max = Number(maxWeeks)
  if (!scheme || !Array.isArray(scheme.weeks) || !Number.isFinite(max) || max < 1) {
    return { scheme, truncated: false }
  }
  if (scheme.weeks.length <= max) return { scheme, truncated: false }
  const out = { ...scheme, weeks: scheme.weeks.slice(0, max) }
  if (out.header && typeof out.header === 'object') {
    out.header = { ...out.header, numberOfWeeks: max }
  }
  return { scheme: out, truncated: true }
}

module.exports = { clampAssessmentPreview, clampSchemePreview }
