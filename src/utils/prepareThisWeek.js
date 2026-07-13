/**
 * Prepare This Week — pure, side-effect-free derivation of the teacher's
 * weekly preparation progress from data they already have (their saved
 * aiGenerations + the MoE calendar week). No Firestore reads happen here:
 * TeacherDashboard passes in the generations list it already fetched, plus
 * the calendar context from moeCalendar.getCurrentForecastWeek(), and this
 * module turns them into the rows/stage/routes the PrepareThisWeek card
 * renders.
 *
 * Framework-free and clock-injectable (`now` ms) so it runs under plain
 * `node` in prepareThisWeek.test.js — same pattern as teacherDashboardIntel.
 *
 * Data rules honoured here:
 *  - The weekly target comes from the teacher's saved Class Timetable
 *    (periods per week for the subject) when one exists; else from the
 *    week's saved Weekly Focus day count; else a conservative default. We
 *    never assume every subject runs five times a week.
 *  - A Record of Work week counts as "updated" only when the teacher filled
 *    its coverage (workDone is pre-seeded from the scheme, so it can't be
 *    the signal).
 *  - Nothing is fabricated: every row reflects a real saved document (or
 *    its absence).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_WEEKLY_TARGET = 5

/* ── small normalisers ─────────────────────────────────────────────── */

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  const n = new Date(t).getTime()
  return Number.isFinite(n) ? n : 0
}

/** 'integrated_science' | 'Integrated Science' → 'integrated science' */
export function normSubject(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** 'Term 2' | '2' | 2 → 2 (or null when no digit present) */
export function termNumberOf(value) {
  const m = String(value ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

/** 'G4' | 'Grade 4' → 'G4' canonical; other ladders ('form-2') pass through lowercased. */
export function normGrade(g) {
  const s = String(g || '').trim()
  if (!s) return ''
  const m = s.match(/^(?:g(?:rade)?\s*)(\d+)$/i)
  return m ? `G${m[1]}` : s.toLowerCase()
}

export function gradeLabelOf(g) {
  const s = String(g || '').trim()
  if (!s) return ''
  const m = s.match(/^(?:g(?:rade)?\s*)?(\d+)$/i)
  if (m) return `Grade ${m[1]}`
  // Non-numeric ladder values ('baby', 'form-2') — prettify lightly.
  return s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function subjectLabelOf(s) {
  const clean = String(s || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Parse a 'YYYY-MM-DD' string to a local-midnight ms timestamp. */
function parseIsoMs(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

/* ── generation field accessors (server + client doc shapes) ─────────
   Exported: teacherRecommendations.js reads the same doc shapes. */

export function genSubject(g) {
  return normSubject(g?.output?.header?.subject || g?.inputs?.subject || g?.meta?.subject || '')
}

export function genGrade(g) {
  return normGrade(g?.output?.header?.grade || g?.output?.header?.class || g?.inputs?.grade || g?.meta?.klass || '')
}

export function genTerm(g) {
  return termNumberOf(g?.output?.header?.term ?? g?.inputs?.term)
}

function newestFirst(list) {
  return [...list].sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
}

/* ── the routes each row opens ─────────────────────────────────────── */

export const PREP_ROUTES = {
  scheme: '/teacher/generate/scheme-of-work',
  focus: '/teacher/generate/weekly-forecast',
  lessons: '/teacher/generate/lesson-plan',
  worksheet: '/teacher/generate/worksheet',
  record: '/teacher/generate/record-of-work',
  library: (id) => `/teacher/library/${id}`,
}

/* ── weekly target from the saved timetable ────────────────────────── */

/**
 * Count how the subject sits in the newest saved Class Timetable:
 *   periods — lessons per week (slots holding the subject's label)
 *   days    — distinct teaching days for the subject
 * Prefers a timetable matching the context grade; falls back to the newest
 * timetable of any grade. Returns null when no timetable mentions the subject.
 */
export function timetableAllocation(generations, { subject, grade } = {}) {
  const want = normSubject(subject)
  if (!want) return null
  const timetables = newestFirst(generations.filter((g) => g.tool === 'class_timetable' && g.output?.slots))
  const ordered = grade
    ? [...timetables.filter((t) => genGrade(t) === normGrade(grade)), ...timetables.filter((t) => genGrade(t) !== normGrade(grade))]
    : timetables
  for (const t of ordered) {
    let periods = 0
    const days = new Set()
    for (const row of Object.values(t.output.slots || {})) {
      if (!row || typeof row !== 'object') continue
      for (const [day, label] of Object.entries(row)) {
        if (normSubject(label) === want) {
          periods += 1
          days.add(day)
        }
      }
    }
    if (periods > 0) return { periods, days: days.size }
  }
  return null
}

/* ── context: which grade + subject is "this week" about? ──────────── */

/**
 * Resolve the teaching context for the week.
 *
 * `preferredSubject` (the persisted last-used context) wins whenever the
 * teacher still has any evidence of teaching that subject — so the card
 * never silently switches subject just because another subject's document
 * was edited more recently. Otherwise the newest relevant saved documents
 * decide: this week's Weekly Focus, then the current term's Scheme of
 * Work, then the current term's Record of Work, then the newest Class
 * Timetable (grade) + profile subject. Null when no subject can be
 * determined — the card then shows its set-up empty state.
 */
export function resolveWeekContext({ generations = [], calendar, profileSubject = '', preferredSubject = '' } = {}) {
  if (!calendar) return null
  const { termNumber, weekNumber } = calendar

  const preferred = normSubject(preferredSubject)
  if (preferred) {
    const docsFor = newestFirst(generations.filter((g) => genSubject(g) === preferred))
    if (docsFor.length || preferred === normSubject(profileSubject)) {
      // Grade: prefer a current-term doc of this subject, else its newest
      // doc, else the newest timetable.
      const graded = docsFor.find((g) => genTerm(g) === termNumber && genGrade(g)) ||
        docsFor.find((g) => genGrade(g))
      const timetable = newestFirst(generations.filter((g) => g.tool === 'class_timetable'))[0]
      return {
        subject: preferred,
        grade: graded ? genGrade(graded) : (timetable ? genGrade(timetable) : ''),
        source: 'preferred',
      }
    }
  }

  const focus = newestFirst(generations.filter((g) =>
    g.tool === 'weekly_forecast' &&
    genTerm(g) === termNumber &&
    termNumberOf(g.output?.header?.weekNumber) === weekNumber &&
    genSubject(g)
  ))[0]
  if (focus) return { subject: genSubject(focus), grade: genGrade(focus), source: 'focus' }

  const scheme = newestFirst(generations.filter((g) =>
    g.tool === 'scheme_of_work' && genTerm(g) === termNumber && genSubject(g)
  ))[0]
  if (scheme) return { subject: genSubject(scheme), grade: genGrade(scheme), source: 'scheme' }

  const record = newestFirst(generations.filter((g) =>
    g.tool === 'record_of_work' && genTerm(g) === termNumber && genSubject(g)
  ))[0]
  if (record) return { subject: genSubject(record), grade: genGrade(record), source: 'record' }

  const profile = normSubject(profileSubject)
  if (profile) {
    const timetable = newestFirst(generations.filter((g) => g.tool === 'class_timetable'))[0]
    return { subject: profile, grade: timetable ? genGrade(timetable) : '', source: 'profile' }
  }
  return null
}

/* ── week attribution ladder ───────────────────────────────────────────
   Which teaching week does a document belong to? In priority order:
     1. Planned teaching date — the teacher-entered lesson date
        (lesson plans store it as meta.date from a native date input;
        output.header.date and inputs.plannedDate are accepted for other/
        future doc shapes).
     2. Linked Weekly Focus week — no link field exists yet (backlog).
     3. Stored term: a doc stamped with a DIFFERENT term never counts
        toward this week, whatever its creation date.
     4. Creation date, as a legacy fallback — flagged `estimated` so the
        UI never presents those counts as precise. updatedAt is never
        consulted, so editing an old document cannot pull it into the
        current week. */

export function weekAttributionOf(g, { weekStartMs, weekEndMs, termNumber } = {}) {
  const planned = parseIsoMs(g?.meta?.date || g?.output?.header?.date || g?.inputs?.plannedDate)
  if (planned != null) {
    return {
      inWeek: planned >= weekStartMs && planned < weekEndMs + DAY_MS,
      estimated: false,
      basis: 'planned',
    }
  }
  const term = genTerm(g)
  if (term != null && term !== termNumber) {
    return { inWeek: false, estimated: false, basis: 'term' }
  }
  const created = toMs(g.createdAt)
  return {
    inWeek: created >= weekStartMs && created < weekEndMs + DAY_MS,
    estimated: true,
    basis: 'created',
  }
}

/** Count docs attributed to this week; `estimated` when any counted doc
 *  fell through to the creation-date fallback. */
function countInWeek(docs, weekWindow) {
  let count = 0
  let estimated = false
  for (const g of docs) {
    const a = weekAttributionOf(g, weekWindow)
    if (a.inWeek) {
      count += 1
      if (a.estimated) estimated = true
    }
  }
  return { count, estimated }
}

/* ── the progress rows ─────────────────────────────────────────────── */

function forecastPreparedDays(focus) {
  const days = Array.isArray(focus?.output?.days) ? focus.output.days : []
  return days.filter((d) =>
    String(d?.topic || '').trim() ||
    (Array.isArray(d?.learningActivities) && d.learningActivities.length > 0) ||
    String(d?.specificCompetence || '').trim()
  ).length
}

/**
 * Build the whole Prepare This Week model. Returns:
 *   { empty, emptyReason?, context?, stage, rows[], continueTo, viewWeekTo }
 * Each row: { key, label, detail, status:'done'|'progress'|'todo'|'alert',
 *             done, target (nullable), to, meta }
 */
export function buildWeekPrep({ generations = [], calendar = null, profileSubject = '', preferredSubject = '', now = Date.now() } = {}) {
  if (!calendar) {
    return { empty: true, emptyReason: 'no-calendar', rows: [] }
  }
  const context = resolveWeekContext({ generations, calendar, profileSubject, preferredSubject })
  if (!context) {
    return { empty: true, emptyReason: 'no-context', rows: [] }
  }

  const { termNumber, weekNumber, beginning, ending, beginningLabel, endingLabel, year } = calendar
  // During school holidays the calendar hands us Week 1 of the NEXT term —
  // the card switches to "Prepare for Next Term" mode: planning rows only,
  // no current-week completion counts (school is closed; there is nothing
  // honest to count).
  const holiday = calendar.isActiveTermNow === false
  const weekStartMs = parseIsoMs(beginning) ?? now
  const weekEndMs = parseIsoMs(ending) ?? now
  const weekWindow = { weekStartMs, weekEndMs, termNumber }
  const subject = context.subject
  const sameSubject = (g) => genSubject(g) === subject

  // Weekly target: timetable allocation → this week's focus day count → default.
  const allocation = timetableAllocation(generations, { subject, grade: context.grade })

  // Scheme of Work for this term + subject.
  const scheme = newestFirst(generations.filter((g) =>
    g.tool === 'scheme_of_work' && genTerm(g) === termNumber && sameSubject(g)
  ))[0] || null

  // This week's Weekly Focus for the subject.
  const focus = newestFirst(generations.filter((g) =>
    g.tool === 'weekly_forecast' &&
    genTerm(g) === termNumber &&
    termNumberOf(g.output?.header?.weekNumber) === weekNumber &&
    sameSubject(g)
  ))[0] || null
  const focusDayTarget = Array.isArray(focus?.output?.days) && focus.output.days.length > 0
    ? focus.output.days.length
    : null

  const dayTarget = allocation?.days ?? focusDayTarget ?? DEFAULT_WEEKLY_TARGET
  const lessonTarget = allocation?.periods ?? focusDayTarget ?? DEFAULT_WEEKLY_TARGET

  const focusPrepared = focus ? Math.min(forecastPreparedDays(focus), dayTarget) : 0

  // Lesson plans + worksheets attributed to this school week for the
  // subject (planned-date first; creation date only as an estimated
  // fallback — see weekAttributionOf).
  const lessons = countInWeek(
    generations.filter((g) => g.tool === 'lesson_plan' && sameSubject(g)),
    weekWindow,
  )
  const worksheets = countInWeek(
    generations.filter((g) => g.tool === 'worksheet' && sameSubject(g)),
    weekWindow,
  )

  // Record of Work: current term + subject, with this week's coverage filled.
  const record = newestFirst(generations.filter((g) =>
    g.tool === 'record_of_work' && genTerm(g) === termNumber && sameSubject(g)
  ))[0] || null
  const recordWeeks = Array.isArray(record?.output?.weeks) ? record.output.weeks : []
  const recordUpdated = recordWeeks.some((w) =>
    termNumberOf(w?.week) === weekNumber && String(w?.coverage || '').trim() !== ''
  )

  const planningRows = [
    {
      key: 'scheme',
      label: scheme ? 'Scheme of Work selected' : 'Scheme of Work missing',
      detail: scheme
        ? [subjectLabelOf(subject), `Term ${termNumber}`].filter(Boolean).join(' · ')
        : `No Term ${termNumber} scheme for ${subjectLabelOf(subject)} yet`,
      status: scheme ? 'done' : 'todo',
      done: scheme ? 1 : 0,
      target: 1,
      to: scheme ? PREP_ROUTES.library(scheme.id) : PREP_ROUTES.scheme,
      meta: scheme ? '✓' : 'Not created',
    },
    {
      key: 'focus',
      label: `Weekly Focus: ${focusPrepared} of ${dayTarget} days prepared`,
      detail: focus ? 'Day-by-day plan for this week' : 'Plan this week from your scheme',
      status: focusPrepared >= dayTarget ? 'done' : focusPrepared > 0 ? 'progress' : 'todo',
      done: focusPrepared,
      target: dayTarget,
      to: focus ? PREP_ROUTES.library(focus.id) : PREP_ROUTES.focus,
      meta: `${focusPrepared} / ${dayTarget}`,
    },
  ]

  const weekRows = [
    {
      key: 'lessons',
      label: `Lesson plans: ${lessons.count} of ${lessonTarget} completed`,
      detail: 'CBC lessons with stages, resources and assessment',
      status: lessons.count >= lessonTarget ? 'done' : lessons.count > 0 ? 'progress' : 'todo',
      done: Math.min(lessons.count, lessonTarget),
      target: lessonTarget,
      to: PREP_ROUTES.lessons,
      meta: `${lessons.estimated ? '≈ ' : ''}${lessons.count} / ${lessonTarget}`,
      estimated: lessons.estimated,
    },
    {
      key: 'worksheet',
      label: worksheets.count > 0
        ? `Worksheet: ${worksheets.count} created`
        : 'Worksheet: none created yet',
      detail: worksheets.count > 0 ? 'Ready to assign or print' : 'Give learners practice on this week’s topics',
      status: worksheets.count > 0 ? 'done' : 'todo',
      done: worksheets.count > 0 ? 1 : 0,
      target: 1,
      to: PREP_ROUTES.worksheet,
      meta: worksheets.count > 0 ? `${worksheets.estimated ? '≈ ' : ''}${worksheets.count} created` : 'None yet',
      estimated: worksheets.estimated,
    },
    {
      key: 'record',
      label: recordUpdated ? 'Record of Work updated' : 'Record of Work: not updated',
      detail: 'Log your teaching and learner progress',
      status: recordUpdated ? 'done' : 'alert',
      done: recordUpdated ? 1 : 0,
      target: 1,
      to: record ? PREP_ROUTES.library(record.id) : PREP_ROUTES.record,
      meta: recordUpdated ? '✓' : 'Not updated',
    },
  ]

  // Holidays: planning ahead is meaningful, current-week completion is not.
  const rows = holiday ? planningRows : [...planningRows, ...weekRows]

  // Stage stepper: Plan (scheme + focus) → Teach (lessons) → Assess
  // (worksheet) → Record. The current stage is the first incomplete group.
  // In holiday mode only planning applies.
  const planDone = planningRows.every((r) => r.status === 'done')
  const stage = holiday
    ? 'plan'
    : !planDone ? 'plan'
    : weekRows[0].status !== 'done' ? 'teach'
    : weekRows[1].status !== 'done' ? 'assess'
    : weekRows[2].status !== 'done' ? 'record'
    : 'done'

  const firstIncomplete = rows.find((r) => r.status !== 'done')
  const viewWeekTo = focus ? PREP_ROUTES.library(focus.id) : PREP_ROUTES.focus

  return {
    empty: false,
    mode: holiday ? 'next-term' : 'week',
    context: {
      grade: context.grade,
      gradeLabel: gradeLabelOf(context.grade),
      subject,
      subjectLabel: subjectLabelOf(subject),
      termNumber,
      weekNumber,
      year: year ?? null,
      rangeLabel: [beginningLabel, endingLabel].filter(Boolean).join(' – '),
      // Holiday extras — the component shows the opening date instead of a
      // week range while school is closed.
      openLabel: calendar.openLabel || '',
      daysToOpen: Number.isFinite(calendar.daysToOpen) ? calendar.daysToOpen : null,
      source: context.source,
    },
    stage,
    rows,
    continueTo: firstIncomplete ? firstIncomplete.to : viewWeekTo,
    viewWeekTo,
  }
}
