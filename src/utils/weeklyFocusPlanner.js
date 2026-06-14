/**
 * Weekly Focus planner — the deterministic, curriculum-aware core of the
 * Weekly Focus / Weekly Forecast studio.
 *
 * The studio plans a week day-by-day, sourcing curriculum data in order:
 *   1. a saved Scheme of Work (handled by weeklyForecast.js — a scheme week
 *      split across teaching days),
 *   2. the Syllabi Studio + uploaded modules (the merged CBC knowledge base
 *      topics, which this module turns into per-topic suggestions), and
 *   3. the teacher's saved Class Timetable (which tells us exactly which
 *      weekdays a subject is taught and how many periods it gets).
 *
 * This file is intentionally dependency-free (no Firebase, no React) so
 * scripts/test-weekly-focus-planner.mjs can unit-test it with plain node,
 * per repo convention.
 */

/** Monday–Friday in week order. The official forecast plans the school week. */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const WEEKDAY_INDEX = Object.fromEntries(WEEKDAYS.map((d, i) => [d, i]))

const asList = (v) => (Array.isArray(v)
  ? v.map((x) => String(x ?? '').trim()).filter(Boolean)
  : (v == null || v === '' ? [] : [String(v).trim()]))

/**
 * Split a free-text curriculum cell (learning activities, competences…) into
 * individual lines. Syllabus cells separate items by newlines, semicolons,
 * or leading bullets/numbers — normalise all of them to a clean list.
 */
export function splitLines(value) {
  if (Array.isArray(value)) return asList(value)
  return String(value || '')
    .split(/\r?\n|;|·|•/)
    .map((s) => s.replace(/^\s*(?:[-*–]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

/** Normalise a grade to the catalogue's 'G4' form (accepts 4, '4', 'g4'). */
export function normalizeGrade(grade) {
  const raw = String(grade ?? '').trim().toUpperCase()
  if (!raw) return ''
  return raw.startsWith('G') ? raw : `G${raw.replace(/[^0-9]/g, '')}`
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Does a timetable subject cell match the forecast subject? The timetable
 * stores library subject labels and the forecast stores teacher-tools labels,
 * which mostly agree but occasionally differ ("Integrated Science" vs
 * "Science"), so match on normalised containment either way.
 */
export function subjectMatches(cellLabel, subjectLabel) {
  const a = norm(cellLabel)
  const b = norm(subjectLabel)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Work out which weekdays a subject is taught — and how many periods it gets
 * a week — from a saved Class Timetable artifact
 * ({ days[], periods[], slots: { [periodId]: { [day]: subjectLabel } } }).
 *
 * Returns { days: ['Monday','Wednesday','Friday'], periodsPerWeek: 3 } with
 * days ordered Mon→Fri (any non-standard day kept, appended after). Returns
 * empty when the timetable doesn't teach the subject (or there's no timetable).
 */
export function subjectScheduleFromTimetable(timetable, subjectLabel) {
  const slots = timetable?.slots
  if (!slots || typeof slots !== 'object' || !subjectLabel) {
    return { days: [], periodsPerWeek: 0 }
  }
  const dayCounts = new Map()
  for (const byDay of Object.values(slots)) {
    if (!byDay || typeof byDay !== 'object') continue
    for (const [day, label] of Object.entries(byDay)) {
      if (subjectMatches(label, subjectLabel)) {
        dayCounts.set(day, (dayCounts.get(day) || 0) + 1)
      }
    }
  }
  const days = Array.from(dayCounts.keys()).sort((a, b) => {
    const ia = WEEKDAY_INDEX[a] ?? 99
    const ib = WEEKDAY_INDEX[b] ?? 99
    return ia - ib || a.localeCompare(b)
  })
  let periodsPerWeek = 0
  for (const n of dayCounts.values()) periodsPerWeek += n
  return { days, periodsPerWeek }
}

/**
 * Build a topic catalogue for one grade + subject from the merged CBC
 * knowledge-base topics (Syllabi Studio + uploaded modules, as returned by
 * listAllSyllabusTopics()). Each entry keeps the per-subtopic curriculum
 * detail so picking a topic can auto-fill the forecast.
 *
 *   [{ topic, source, subtopics: [{ name, specificCompetence,
 *      learningActivities, expectedStandard }], specificOutcomes,
 *      suggestedMaterials }]
 *
 * `source` is 'syllabi_studio' or 'module' (anything pulled from Firestore /
 * an uploaded module) so the studio can flag when it fell back to a module.
 */
export function buildTopicCatalog(kbTopics, grade, subjectSlug) {
  const g = normalizeGrade(grade)
  const subj = String(subjectSlug || '').toLowerCase()
  if (!g || !subj || !Array.isArray(kbTopics)) return []
  const out = []
  for (const t of kbTopics) {
    if (normalizeGrade(t?.grade) !== g) continue
    if (String(t?.subject || '').toLowerCase() !== subj) continue
    const topic = String(t.topic || '').trim()
    if (!topic) continue
    out.push({
      topic,
      source: t._source === 'firestore' ? 'module' : (t.origin === 'syllabi_studio' ? 'syllabi_studio' : (t._source || 'syllabi_studio')),
      subtopics: (Array.isArray(t.subtopics) ? t.subtopics : []).map((s) => (
        typeof s === 'string'
          ? { name: s, specificCompetence: '', learningActivities: '', expectedStandard: '' }
          : {
            name: String(s?.name || '').trim(),
            specificCompetence: String(s?.specificCompetence || '').trim(),
            learningActivities: s?.learningActivities || '',
            expectedStandard: String(s?.expectedStandard || '').trim(),
          }
      )).filter((s) => s.name),
      specificOutcomes: asList(t.specificOutcomes),
      suggestedMaterials: asList(t.suggestedMaterials),
    })
  }
  // Stable, human-friendly order.
  return out.sort((a, b) => a.topic.localeCompare(b.topic))
}

/** The sub-topic names available under a topic in the catalogue. */
export function subtopicsForTopic(catalog, topic) {
  const entry = findTopic(catalog, topic)
  return entry ? entry.subtopics.map((s) => s.name) : []
}

function findTopic(catalog, topic) {
  if (!Array.isArray(catalog) || !topic) return null
  const want = String(topic).toLowerCase()
  return catalog.find((e) => e.topic.toLowerCase() === want) || null
}

/**
 * Resolve the per-day forecast fields the curriculum suggests for a topic
 * (optionally narrowed to one sub-topic). When no sub-topic is given the
 * fields are aggregated across the topic's sub-topics so the teacher still
 * sees the topic's competences, activities and standards.
 *
 * Returns null when the topic isn't in the catalogue (caller keeps the
 * teacher's free text). Resources are intentionally left to the teacher /
 * the AI assistant — the 5-column syllabus has no T/L resources column.
 */
export function dayFieldsFromTopic(catalog, topic, subtopicName = '') {
  const entry = findTopic(catalog, topic)
  if (!entry) return null

  let subs = entry.subtopics
  if (subtopicName) {
    const want = String(subtopicName).toLowerCase()
    const match = entry.subtopics.find((s) => s.name.toLowerCase() === want)
    if (match) subs = [match]
  }

  const competences = []
  const activities = []
  const standards = []
  for (const s of subs) {
    if (s.specificCompetence) competences.push(s.specificCompetence)
    for (const a of splitLines(s.learningActivities)) activities.push(a)
    if (s.expectedStandard) standards.push(s.expectedStandard)
  }
  if (!competences.length) for (const o of entry.specificOutcomes) competences.push(o)

  return {
    topic: entry.topic,
    subtopic: subtopicName || subs.map((s) => s.name).join(', '),
    specificCompetence: dedupe(competences).join('; '),
    learningActivities: dedupe(activities),
    expectedStandard: dedupe(standards).join(' '),
    resources: dedupe(entry.suggestedMaterials),
    source: entry.source,
  }
}

function dedupe(list) {
  const seen = new Set()
  const out = []
  for (const item of list) {
    const key = String(item).toLowerCase()
    if (item && !seen.has(key)) { seen.add(key); out.push(item) }
  }
  return out
}

/**
 * Helpful, non-blocking alerts for the current forecast. Pure: takes the
 * already-derived pieces of studio state and returns
 *   [{ level: 'error'|'warn'|'info', message }]
 * ordered most-serious first.
 *
 * @param {object} ctx
 *   days                 the day editors (with .day weekday, .topic, …)
 *   subjectLabel         the chosen subject's display label
 *   timetableSelected    whether the teacher picked a saved timetable
 *   scheduleDays         weekdays the timetable teaches this subject
 *   periodsPerWeek       periods the timetable gives this subject
 *   topicCatalog         catalogue for the grade+subject (for grade/term checks)
 *   usedModuleFallback   true if any auto-filled topic came from a module
 */
export function forecastAlerts(ctx = {}) {
  const {
    days = [],
    subjectLabel = '',
    timetableSelected = false,
    scheduleDays = [],
    periodsPerWeek = 0,
    topicCatalog = [],
    usedModuleFallback = false,
  } = ctx
  const alerts = []
  const filled = days.filter((d) => String(d?.topic || '').trim())

  // Subject not in the timetable for this week.
  if (timetableSelected && scheduleDays.length === 0 && subjectLabel) {
    alerts.push({
      level: 'warn',
      message: `${subjectLabel} doesn't appear in the selected class timetable — choose the days manually, or check the timetable.`,
    })
  }

  // More teaching days planned than the timetable allocates periods for.
  if (timetableSelected && periodsPerWeek > 0 && days.length > periodsPerWeek) {
    alerts.push({
      level: 'warn',
      message: `You've planned ${days.length} day${days.length === 1 ? '' : 's'} but the timetable gives ${subjectLabel || 'this subject'} only ${periodsPerWeek} period${periodsPerWeek === 1 ? '' : 's'} this week.`,
    })
  }

  // Topics that aren't in this grade/subject's curriculum catalogue.
  if (topicCatalog.length) {
    const known = new Set(topicCatalog.map((e) => e.topic.toLowerCase()))
    const offCurriculum = dedupe(
      filled
        .map((d) => String(d.topic).trim())
        .filter((t) => !known.has(t.toLowerCase())),
    )
    if (offCurriculum.length) {
      alerts.push({
        level: 'warn',
        message: `Not in the ${subjectLabel || 'subject'} curriculum for this grade: ${offCurriculum.join(', ')}. Double-check the grade, subject and term.`,
      })
    }
  }

  // Missing learning activities / expected standards on filled days.
  const missing = filled.filter((d) => (
    (Array.isArray(d.learningActivities) ? d.learningActivities.length === 0 : !String(d.learningActivities || '').trim())
    || !String(d.expectedStandard || '').trim()
  ))
  if (missing.length) {
    const dayNames = missing.map((d) => d.day).filter(Boolean)
    alerts.push({
      level: 'info',
      message: `Add learning activities and an expected standard${dayNames.length ? ` for ${dayNames.join(', ')}` : ''} so the forecast is complete.`,
    })
  }

  // Syllabus was incomplete; module data filled the gap.
  if (usedModuleFallback) {
    alerts.push({
      level: 'info',
      message: 'Some details came from an uploaded module because the syllabus entry was incomplete — review them before printing.',
    })
  }

  const rank = { error: 0, warn: 1, info: 2 }
  return alerts.sort((a, b) => rank[a.level] - rank[b.level])
}
