/**
 * AI Recommendations — pure, condition-gated action cards (redesign §8).
 *
 * Replaces the passive "AI insights" copy with recommendations that are only
 * emitted when their condition is genuinely true in the teacher's data, and
 * that each carry a direct action. Same contract as prepareThisWeek.js: no
 * imports of Firebase or React, an injectable clock, and the caller passes
 * the generations/assessments the dashboard already fetched — so this runs
 * under plain `node` in teacherRecommendations.test.js and adds no reads.
 *
 * Honesty rules:
 *  - A recommendation with a false condition is never emitted (no padding).
 *  - Each id is emitted at most once (no repetition).
 *  - Week-scoped recommendations are suppressed during school holidays.
 *  - "Draft" test papers means what the dashboard already means by it:
 *    papers with zero questions.
 */

import {
  genSubject,
  genTerm,
  gradeLabelOf,
  normSubject,
  resolveWeekContext,
  subjectLabelOf,
  weekAttributionOf,
  PREP_ROUTES,
} from './prepareThisWeek.js'

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  const n = new Date(t).getTime()
  return Number.isFinite(n) ? n : 0
}

function parseIsoMs(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Subjects the teacher demonstrably teaches, ranked by evidence: docs in
 * the current term count most, then timetable presence, then the profile
 * subject. Returns [{subject, score}] sorted best-first.
 */
export function subjectsTaught({ generations = [], profileSubject = '', termNumber = null } = {}) {
  const score = new Map()
  const bump = (s, n) => {
    const key = normSubject(s)
    if (!key) return
    score.set(key, (score.get(key) || 0) + n)
  }

  for (const g of generations) {
    const s = genSubject(g)
    if (!s) continue
    const inTerm = termNumber != null && genTerm(g) === termNumber
    bump(s, inTerm ? 3 : 1)
  }
  // Timetable slots hold subject labels — strong evidence of a real class.
  for (const g of generations) {
    if (g.tool !== 'class_timetable' || !g.output?.slots) continue
    for (const row of Object.values(g.output.slots)) {
      if (!row || typeof row !== 'object') continue
      for (const label of Object.values(row)) bump(label, 2)
    }
  }
  bump(profileSubject, 2)

  return [...score.entries()]
    .map(([subject, n]) => ({ subject, score: n }))
    .sort((a, b) => b.score - a.score)
}

/**
 * Build the recommendation list, best-first. Each entry:
 *   { id, icon, title, text, actionLabel, to }
 * The caller renders the first `max` (default 3) and offers "View all".
 */
export function buildRecommendations({
  generations = [],
  assessments = [],
  calendar = null,
  profileSubject = '',
} = {}) {
  const out = []
  const termNumber = calendar?.termNumber ?? null
  const weekNumber = calendar?.weekNumber ?? null
  const holiday = calendar ? calendar.isActiveTermNow === false : true
  const weekStartMs = parseIsoMs(calendar?.beginning)
  const weekEndMs = parseIsoMs(calendar?.ending)
  const weekWindow = weekStartMs != null && weekEndMs != null
    ? { weekStartMs, weekEndMs, termNumber }
    : null

  const context = calendar
    ? resolveWeekContext({ generations, calendar, profileSubject })
    : null

  /* 1 ── "<Subject> is not planned yet" — the teacher teaches it but has no
         Scheme of Work for the current term. Best unplanned subject only. */
  if (termNumber != null) {
    const schemed = new Set(
      generations
        .filter((g) => g.tool === 'scheme_of_work' && genTerm(g) === termNumber)
        .map((g) => genSubject(g))
        .filter(Boolean),
    )
    const unplanned = subjectsTaught({ generations, profileSubject, termNumber })
      .find((s) => !schemed.has(s.subject))
    if (unplanned) {
      const gradeBit = context?.grade ? `${gradeLabelOf(context.grade)} syllabus` : 'syllabus'
      out.push({
        id: `scheme-${unplanned.subject}`,
        icon: '📘',
        title: `${subjectLabelOf(unplanned.subject)} is not planned yet`,
        text: `Create a Scheme of Work using the ${gradeBit} and current school calendar.`,
        actionLabel: 'Create Scheme',
        to: PREP_ROUTES.scheme,
      })
    }
  }

  /* Week-scoped conditions need an open school week. */
  if (!holiday && weekWindow && weekNumber != null && context) {
    const sameSubject = (g) => genSubject(g) === context.subject

    const lessonsThisWeek = generations.filter((g) =>
      g.tool === 'lesson_plan' && sameSubject(g) && weekAttributionOf(g, weekWindow).inWeek,
    ).length
    const focus = generations
      .filter((g) =>
        g.tool === 'weekly_forecast' && genTerm(g) === termNumber &&
        (genSubject(g) === context.subject) &&
        Number(g.output?.header?.weekNumber) === weekNumber)
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0]
    const focusDays = Array.isArray(focus?.output?.days)
      ? focus.output.days.filter((d) => String(d?.topic || '').trim()).length
      : 0

    /* 2 ── "Record of Work is behind" — teaching evidence exists this week
           but the record's week entry has no coverage. */
    const record = generations
      .filter((g) => g.tool === 'record_of_work' && genTerm(g) === termNumber && sameSubject(g))
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))[0]
    const recordUpdated = Array.isArray(record?.output?.weeks) && record.output.weeks.some((w) =>
      Number(String(w?.week ?? '').match(/\d+/)?.[0]) === weekNumber &&
      String(w?.coverage || '').trim() !== '',
    )
    const taughtEvidence = lessonsThisWeek > 0 || focusDays > 0
    if (taughtEvidence && !recordUpdated) {
      const n = lessonsThisWeek || focusDays
      out.push({
        id: 'record-behind',
        icon: '🗂️',
        title: 'Record of Work is behind',
        text: `${n} lesson${n === 1 ? ' was' : 's were'} planned for this week but ${n === 1 ? 'has' : 'have'} not been recorded.`,
        actionLabel: 'Update now',
        to: record ? PREP_ROUTES.library(record.id) : PREP_ROUTES.record,
      })
    }

    /* 3 ── "Create a worksheet" — a lesson exists this week with no learner
           practice beside it. */
    const worksheetsThisWeek = generations.filter((g) =>
      g.tool === 'worksheet' && sameSubject(g) && weekAttributionOf(g, weekWindow).inWeek,
    ).length
    if (lessonsThisWeek > 0 && worksheetsThisWeek === 0) {
      out.push({
        id: 'worksheet-missing',
        icon: '📝',
        title: 'Create a worksheet',
        text: 'You completed a lesson this week but have not created learner practice.',
        actionLabel: 'Create worksheet',
        to: PREP_ROUTES.worksheet,
      })
    }

    /* 4 ── "Prepare Friday's quiz" — the week has topics but no test yet. */
    const testsThisWeek = assessments.filter((a) => {
      const t = toMs(a.createdAt)
      return t >= weekStartMs && t < weekEndMs + DAY_MS
    }).length
    if (focusDays > 0 && testsThisWeek === 0) {
      out.push({
        id: 'friday-quiz',
        icon: '🧪',
        title: 'Prepare Friday’s quiz',
        text: 'Create a short test using this week’s topics.',
        actionLabel: 'Create quiz',
        to: '/teacher/test-papers/new',
      })
    }
  }

  /* 5 ── "Test papers are still drafts" — papers with no questions yet
         (the same definition of "draft" the rest of the dashboard uses). */
  const draftPapers = assessments.filter((a) =>
    !(typeof a.questionCount === 'number' && a.questionCount > 0),
  ).length
  if (draftPapers > 0) {
    out.push({
      id: 'draft-papers',
      icon: '📄',
      title: draftPapers === 1 ? 'A test paper is still a draft' : 'Test papers are still drafts',
      text: `Review, publish or archive ${draftPapers === 1 ? 'your unfinished test paper' : `${draftPapers} unfinished test papers`}.`,
      actionLabel: 'Review drafts',
      to: '/teacher/test-papers',
    })
  }

  // One entry per id — conditions above can't repeat, but keep the guarantee.
  const seen = new Set()
  return out.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}
