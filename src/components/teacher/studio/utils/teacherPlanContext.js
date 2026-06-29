/**
 * teacherPlanContext — pure helpers for the Lesson Plan Studio's two
 * "intelligent" features:
 *
 *   1. Context auto-fill — resolve a teacher's saved Weekly Forecast row into
 *      the studio's own grade / subject / topic / subtopic / date values, so
 *      the studio can open pre-filled to "this week's lesson". The matching is
 *      deliberately tolerant (the forecast stores free-ish text; the studio
 *      needs an EXACT syllabi option) and never returns a value that isn't a
 *      real option — the caller only sets fields it can trust.
 *
 *   2. Aligned Teaching Kit — distil the finished plan's CBC anchors
 *      (specificCompetence / expectedStandard / lessonGoal) into a compact
 *      instruction string the companion generators (worksheet / homework /
 *      test) already forward to their prompt, so every kit item aligns to the
 *      same lesson.
 *
 * Pure ES module — no React / Firebase / browser deps — so it unit-tests under
 * plain node and the resolution logic stays in one tested place.
 */

/** Lowercase + strip non-alphanumerics for tolerant comparison. */
function normName(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Monday-based offset for a weekday name (Mon=0 … Sun=6). */
const DAY_OFFSET = {
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
}

/**
 * Map a forecast's grade label onto one of the studio's CBC grade values
 * ("Grade 1"–"Grade 6", "Form 1"–"Form 4", "Nursery", "Reception"). Returns ''
 * when it can't map confidently (so the caller leaves the field blank rather
 * than wedging an invalid <select> value the studio would immediately clear).
 */
export function mapForecastGrade(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return ''
  if (/nursery/i.test(s)) return 'Nursery'
  if (/reception/i.test(s)) return 'Reception'
  const form = s.match(/form\s*([1-4])/i)
  if (form) return `Form ${form[1]}`
  const grade = s.match(/grade\s*([1-9]|1[0-2])/i)
  if (grade) return `Grade ${grade[1]}`
  // A bare number: only treat 1–6 as a CBC primary grade. Secondary classes
  // ("Form N") are ambiguous as a bare digit, so we require the explicit word.
  const digit = s.match(/(?:^|\D)([1-6])(?:\D|$)/)
  if (digit) return `Grade ${digit[1]}`
  return ''
}

/**
 * Find the syllabi subject KEY (e.g. "Mathematics Syllabus (Grades 4-6)") whose
 * cleaned display name matches the forecast subject. Returns '' when no match.
 * @param {string} raw            forecast subject (e.g. "Mathematics" / "mathematics")
 * @param {string[]} keys         subject keys from getSubjectsForGrade()
 * @param {(k:string)=>string} cleanFn  cleanSubjectName
 */
export function matchSubjectKey(raw, keys, cleanFn) {
  const want = normName(raw)
  if (!want || !Array.isArray(keys)) return ''
  const clean = (k) => normName(typeof cleanFn === 'function' ? cleanFn(k) : k)
  return (
    keys.find((k) => clean(k) === want) ||
    keys.find((k) => clean(k).includes(want) || want.includes(clean(k))) ||
    ''
  )
}

/**
 * Find the topic object ({ label, subtopics }) matching a forecast topic, or
 * null. Exact (normalised) match first, then containment either way.
 */
export function matchTopicLabel(raw, topics) {
  const want = normName(raw)
  if (!want || !Array.isArray(topics)) return null
  return (
    topics.find((t) => t && normName(t.label) === want) ||
    topics.find((t) => {
      const n = normName(t && t.label)
      return n && (n.includes(want) || want.includes(n))
    }) ||
    null
  )
}

/** Find the exact subtopic string matching a forecast subtopic, or ''. */
export function matchSubtopicLabel(raw, subtopics) {
  const want = normName(raw)
  if (!want || !Array.isArray(subtopics)) return ''
  return (
    subtopics.find((s) => normName(s) === want) ||
    subtopics.find((s) => {
      const n = normName(s)
      return n && (n.includes(want) || want.includes(n))
    }) ||
    ''
  )
}

/**
 * Pick the forecast day row to use: today's weekday if it has a topic,
 * otherwise the first day with a topic. Returns null when none qualify.
 */
export function pickForecastDay(days, todayName) {
  const list = Array.isArray(days) ? days.filter((d) => d && d.topic) : []
  if (!list.length) return null
  const want = String(todayName == null ? '' : todayName).trim().toLowerCase()
  return list.find((d) => String(d.day || '').trim().toLowerCase() === want) || list[0]
}

/**
 * Compute the ISO date ("YYYY-MM-DD") for a forecast day, given the week's
 * Monday date and the day name. Falls back to the Monday date when the day name
 * is unknown, and to '' when the base date isn't a valid ISO date.
 */
export function forecastDayDate(weekBeginning, dayName) {
  const base = String(weekBeginning == null ? '' : weekBeginning).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return ''
  const off = DAY_OFFSET[String(dayName == null ? '' : dayName).trim().toLowerCase()]
  if (off == null) return base
  const [y, m, d] = base.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + off))
  return dt.toISOString().slice(0, 10)
}

/**
 * Build a compact "align to this lesson" instruction string from the plan's
 * CBC anchors, capped so it fits the generators' `instructions` field (500
 * chars server-side). Returns '' when the plan carries none of the anchors.
 */
export function buildAlignmentInstructions(planJson, max = 480) {
  if (!planJson || typeof planJson !== 'object') return ''
  const parts = []
  if (planJson.specificCompetence) parts.push(`Specific competence: ${String(planJson.specificCompetence).trim()}`)
  if (planJson.expectedStandard) parts.push(`Expected standard: ${String(planJson.expectedStandard).trim()}`)
  if (planJson.lessonGoal) parts.push(`Lesson goal: ${String(planJson.lessonGoal).trim()}`)
  if (!parts.length) return ''
  return `Align this to the lesson plan it accompanies. ${parts.join('. ')}.`.slice(0, max)
}
