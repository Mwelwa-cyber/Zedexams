/**
 * Weekly Forecast derivation — the deterministic core of the Weekly
 * Forecast studio. A forecast is the scheme of work's week split across
 * the teaching days (the official document repeats the week's content
 * per day, with a REMARKS column the teacher annotates after each
 * lesson), so the studio builds one FROM a saved scheme — no AI.
 *
 * Saved schemes come in two shapes:
 *   • the app generator's schema (schemeOfWorkSchema.js): weeks[] of
 *     { weekNumber, topic, subtopics[], specificOutcomes[],
 *       teachingLearningActivities[], materials[], assessment, references }
 *   • the new official 9-column shape: weeks[] of
 *     { week, topic, subtopic, specificCompetences[], learningActivities[],
 *       expectedStandard, methods[], tlAids[], references }
 * normalizeSchemeWeek() flattens either into the forecast's day fields.
 *
 * Dependency-free so scripts/test-weekly-forecast.mjs can unit-test it
 * with plain node, per repo convention.
 */

const asList = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : (v ? [String(v).trim()] : []))
const joined = (v, sep = '; ') => asList(v).join(sep)

/** The weeks array of a saved scheme output, whichever shape it is. */
export function schemeWeeks(schemeOutput) {
  return Array.isArray(schemeOutput?.weeks) ? schemeOutput.weeks : []
}

/** Week number for either shape (weekNumber in the app schema, week in the 9-col shape). */
export function weekNumberOf(week) {
  const n = Number(week?.weekNumber ?? week?.week)
  return Number.isFinite(n) ? n : null
}

/** Is this scheme week in the official 9-column shape? */
export function isOfficialSchemeWeek(week) {
  return Boolean(week) && (week.subtopic !== undefined || week.specificCompetences !== undefined || week.tlAids !== undefined)
}

/**
 * Is a whole saved scheme output in the official 9-column format?
 * Covers the v2 generator ("2.0"), the marketing sample ("sow-table-…"),
 * and shape-sniffs anything unversioned.
 */
export function isOfficialScheme(schemeOutput) {
  if (!schemeOutput) return false
  const v = String(schemeOutput.schemaVersion || '')
  if (v === '2.0' || v.startsWith('sow-table')) return true
  return isOfficialSchemeWeek(schemeWeeks(schemeOutput)[0])
}

/**
 * Flatten a scheme week (either shape) into the forecast's per-day
 * fields. Old-schema weeks have no expectedStandard — the assessment
 * sentence is the closest official equivalent, so it stands in.
 */
export function normalizeSchemeWeek(week) {
  if (!week) return null
  if (isOfficialSchemeWeek(week)) {
    return {
      weekNumber: weekNumberOf(week),
      topic: String(week.topic || '').trim(),
      subtopic: String(week.subtopic || '').trim(),
      specificCompetence: joined(week.specificCompetences),
      learningActivities: asList(week.learningActivities),
      expectedStandard: String(week.expectedStandard || '').trim(),
      resources: asList(week.tlAids),
    }
  }
  return {
    weekNumber: weekNumberOf(week),
    topic: String(week.topic || '').trim(),
    subtopic: joined(week.subtopics, ', '),
    specificCompetence: joined(week.specificOutcomes),
    learningActivities: asList(week.teachingLearningActivities),
    expectedStandard: String(week.assessment || '').trim(),
    resources: asList(week.materials),
  }
}

/**
 * Build the forecast days from a scheme week: the week's content
 * repeated per teaching day (exactly like the printed document), each
 * day independently editable afterwards. REMARKS starts blank — the
 * teacher fills it in after the lesson.
 */
export function buildForecastDays(week, dayCount = 3) {
  const base = normalizeSchemeWeek(week)
  if (!base) return []
  const n = Number(dayCount)
  const days = Math.max(1, Math.min(5, Number.isFinite(n) && dayCount !== '' && dayCount !== null ? n : 3))
  return Array.from({ length: days }, (_, i) => ({
    day: String(i + 1),
    topic: base.topic,
    subtopic: base.subtopic,
    specificCompetence: base.specificCompetence,
    learningActivities: [...base.learningActivities],
    expectedStandard: base.expectedStandard,
    resources: [...base.resources],
    remarks: '',
  }))
}
