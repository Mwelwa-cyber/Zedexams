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
  genGrade,
  genSubject,
  genTerm,
  gradeLabelOf,
  normGrade,
  normSubject,
  resolveWeekContext,
  subjectLabelOf,
  weekAttributionOf,
  PREP_ROUTES,
} from './prepareThisWeek.js'
import { oldestDueIncompleteWeek } from './recordOfWorkStatus.js'

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
 * Is there a Scheme of Work for this exact subject in this term (and grade,
 * when a grade is known)? Subject- and grade-scoped so a Technology Studies
 * scheme never satisfies English — the bug the per-assignment cards had.
 * Grade-less legacy schemes still count for their subject (same leniency the
 * rest of the dashboard applies in prepareThisWeek's `sameSubject`).
 */
function hasSchemeFor(generations, { subject, grade, termNumber }) {
  const wantSubject = normSubject(subject)
  if (!wantSubject) return false
  const wantGrade = normGrade(grade)
  return generations.some((g) =>
    g.tool === 'scheme_of_work' &&
    genTerm(g) === termNumber &&
    genSubject(g) === wantSubject &&
    (!wantGrade || !genGrade(g) || genGrade(g) === wantGrade),
  )
}

/**
 * Deep link to the Scheme of Work Studio pre-seeded with THIS card's exact
 * context (grade/subject/term/curriculum/class), so the studio never falls
 * back to the active dashboard subject. The subject is underscore-encoded to
 * match the studio's selector seed (same convention as the short-test link).
 */
function schemeStudioRoute({ grade, subject, termNumber, curriculum, className }) {
  const qs = new URLSearchParams()
  const g = normGrade(grade)
  const s = normSubject(subject)
  if (g) qs.set('grade', g)
  if (s) qs.set('subject', s.replace(/ /g, '_'))
  if (termNumber != null) qs.set('term', String(termNumber))
  if (curriculum) qs.set('curriculum', curriculum === 'previous' ? 'previous' : 'cbc')
  const cls = typeof className === 'string' ? className.trim() : ''
  if (cls) qs.set('className', cls)
  const str = qs.toString()
  return str ? `${PREP_ROUTES.scheme}?${str}` : PREP_ROUTES.scheme
}

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
  preferredSubject = '',
  profileGrade = '',
  // The specific teaching assignment this list is for (profile mode). When
  // present it is the IMMUTABLE subject/grade context for the scheme card —
  // never a global ranking or the active dashboard subject — and its stable
  // identifiers are stamped on the recommendation.
  assignment = null,
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

  // Same context resolution (including the persisted preferred subject) as
  // Prepare This Week, so recommendations always belong to the grade +
  // subject the teacher can SEE on that card.
  const context = calendar
    ? resolveWeekContext({ generations, calendar, profileSubject, preferredSubject, profileGrade })
    : null

  /* 1 ── "<Subject> is not planned yet" — the teacher teaches THIS subject but
         has no Scheme of Work for the current term. Bound to this card's own
         subject context (the assignment, else the resolved week context) — NOT
         a global "best unplanned subject" ranking, which is what made every
         per-assignment card show the same (highest-scored) subject. */
  if (termNumber != null) {
    // Immutable subject/grade for this card: the assignment when we have one,
    // otherwise the resolved week context. Either way it is the subject the
    // teacher SEES on this card — never the active dashboard subject.
    const cardSubject = assignment?.subject
      ? normSubject(assignment.subject)
      : (context ? context.subject : '')
    const cardGrade = assignment?.grade
      ? normGrade(assignment.grade)
      : (context ? context.grade : '')
    if (cardSubject && !hasSchemeFor(generations, { subject: cardSubject, grade: cardGrade, termNumber })) {
      const subjectName = subjectLabelOf(cardSubject)
      const gradeLabel = cardGrade ? gradeLabelOf(cardGrade) : ''
      const scopeBits = [gradeLabel, subjectName].filter(Boolean).join(' ')
      const curriculum = assignment?.curriculumType || assignment?.curriculum || ''
      const className = typeof assignment?.className === 'string' ? assignment.className.trim() : ''
      out.push({
        id: `scheme-${cardSubject}`,
        type: 'missing-scheme',
        icon: '📘',
        // Immutable subject context carried on the recommendation itself, so
        // rendering, the CTA and any downstream consumer read the SAME subject.
        assignmentId: assignment?.id || null,
        curriculumId: curriculum || null,
        gradeId: cardGrade || '',
        gradeLabel,
        classId: assignment?.classId || null,
        className: className || null,
        subjectId: cardSubject,
        subjectName,
        termId: termNumber,
        schoolYear: calendar?.year ?? null,
        title: `${subjectName} is not planned yet`,
        text: `Create a Scheme of Work for ${scopeBits || subjectName} using the correct syllabus and current school calendar.`,
        actionLabel: 'Create Scheme',
        to: schemeStudioRoute({ grade: cardGrade, subject: cardSubject, termNumber, curriculum, className }),
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
      // Deep-link to the OLDEST due week with nothing recorded — an earlier
      // unrecorded week, not necessarily today's, is the real cause of the
      // behind status. The studio opens that record (?id=) focused on that
      // week (&week=). Recorded coverage always outranks date-derived states.
      const targetWeek = record ? oldestDueIncompleteWeek(record.output?.weeks, weekNumber) : null
      const targetRow = targetWeek != null
        ? (record.output?.weeks || []).find((w) => Number(w?.week) === targetWeek)
        : null
      const scopeBits = [context.grade ? gradeLabelOf(context.grade) : '', subjectLabelOf(context.subject)].filter(Boolean).join(' ')
      out.push({
        id: 'record-behind',
        icon: '🗂️',
        title: 'Record of Work needs updating',
        text: targetWeek != null
          ? (String(targetRow?.topic || '').trim()
            ? `${scopeBits} has planned work for Week ${targetWeek}, but actual coverage has not been recorded.`
            : `${scopeBits} Week ${targetWeek} has not been recorded yet.`)
          : `${n} lesson${n === 1 ? ' was' : 's were'} planned for this week but ${n === 1 ? 'has' : 'have'} not been recorded.`,
        actionLabel: targetWeek != null ? `Update Week ${targetWeek}` : 'Update now',
        to: record
          ? (targetWeek != null
            ? `${PREP_ROUTES.record}?id=${record.id}&week=${targetWeek}`
            : PREP_ROUTES.library(record.id))
          : PREP_ROUTES.record,
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

    /* 4 ── "Create Friday's short test" — the week has topics but no test
           yet. Worded for what actually exists: the standalone Quiz Studio
           was retired, so short assessments live in the Assessment Paper Studio. The
           deep link preselects grade/subject/term through the studio's
           existing lesson-kit params (assessmentDefaultsFromParams); test
           type and question count are not supported params, so they are
           not promised. */
    const testsThisWeek = assessments.filter((a) => {
      const t = toMs(a.createdAt)
      return t >= weekStartMs && t < weekEndMs + DAY_MS
    }).length
    if (focusDays > 0 && testsThisWeek === 0) {
      const qs = new URLSearchParams()
      if (context.grade) qs.set('grade', context.grade)
      if (context.subject) qs.set('subject', context.subject.replace(/ /g, '_'))
      if (termNumber != null) qs.set('term', String(termNumber))
      out.push({
        id: 'friday-short-test',
        icon: '🧪',
        title: 'Create Friday’s short test',
        text: 'Create a short assessment using this week’s topics.',
        actionLabel: 'Create short test',
        to: `/teacher/assessment-papers/new?${qs.toString()}`,
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
      to: '/teacher/assessment-papers',
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

// Recommendations that are independent of any one grade/subject (they read the
// whole test-paper list), so across a multi-class profile they're emitted once.
const GLOBAL_REC_IDS = new Set(['draft-papers'])

/**
 * "Grade 4A · Mathematics" scope tag for a per-assignment recommendation. The
 * class/stream is kept so two assignments of the SAME grade+subject in different
 * classes stay visibly distinct (never merged).
 */
function assignmentScopeLabel(a) {
  const grade = gradeLabelOf(a.grade)
  const cls = typeof a.className === 'string' ? a.className.trim() : ''
  const gradeBit = [grade, cls].filter(Boolean).join(' ') // "Grade 4 A" / "Grade 4"
  const subject = subjectLabelOf(a.subject)
  return [gradeBit, subject].filter(Boolean).join(' · ')
}

/** Stable per-assignment identity: the Firestore id, else grade+subject+class. */
function assignmentIdentity(a) {
  return a.id || `${a.grade || ''}:${a.subject || ''}:${(a.className || '').trim()}`
}

/**
 * Whole-profile recommendations: run the per-context engine for EVERY active
 * assignment so a teacher who handles several classes sees prep gaps across all
 * of them, not just the active one. Per-assignment cards are tagged with a
 * `scope` label + a class-unique id and interleaved round-robin (so every class
 * surfaces before any repeats); profile-wide cards (draft papers) appear once.
 *
 * With one active assignment (or none), this is exactly the single-context
 * `buildRecommendations` output — zero change for the common case.
 */
export function buildProfileRecommendations({
  generations = [],
  assessments = [],
  calendar = null,
  assignments = [],
  profileSubject = '',
  preferredSubject = '',
  profileGrade = '',
} = {}) {
  const active = (Array.isArray(assignments) ? assignments : []).filter(
    (a) => a && a.isActive !== false && a.subject,
  )
  if (active.length <= 1) {
    // Pin to the single assignment when present; else fall back to the passed
    // context (profile-less teachers keep today's behaviour exactly).
    const a = active[0]
    return buildRecommendations({
      generations,
      assessments,
      calendar,
      profileSubject: a ? a.subject : profileSubject,
      preferredSubject: a ? a.subject : preferredSubject,
      profileGrade: a ? a.grade : profileGrade,
      assignment: a || null,
    })
  }

  const perAssignment = []
  const globals = []
  const globalSeen = new Set()
  for (const a of active) {
    const recs = buildRecommendations({
      generations,
      assessments,
      calendar,
      profileSubject: a.subject,
      preferredSubject: a.subject,
      profileGrade: a.grade,
      assignment: a,
    })
    const mine = []
    for (const r of recs) {
      if (GLOBAL_REC_IDS.has(r.id)) {
        if (!globalSeen.has(r.id)) { globalSeen.add(r.id); globals.push(r) }
        continue
      }
      mine.push({ ...r, id: `${r.id}::${assignmentIdentity(a)}`, scope: assignmentScopeLabel(a) })
    }
    perAssignment.push(mine)
  }

  // Round-robin interleave across classes, then the once-only profile cards.
  const merged = []
  for (let i = 0; ; i++) {
    let any = false
    for (const list of perAssignment) {
      if (list[i]) { merged.push(list[i]); any = true }
    }
    if (!any) break
  }
  merged.push(...globals)

  // One card per (assignment, recommendation type). Per-assignment ids already
  // fold in the assignment identity, so aliased/duplicate assignments (same id
  // appearing twice) can't produce two identical cards.
  const seen = new Set()
  return merged.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
}
