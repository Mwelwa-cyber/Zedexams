// Record of Work — planned-teaching integration (pure, unit-testable).
//
// The Record of Work is the statutory weekly log of what was ACTUALLY taught.
// These helpers seed it from the School Calendar (real week-ending dates) and
// pre-fill each week's planned topic from the teacher's LESSON PLANS for that
// term — joined on the planned school week (meta.planned.schoolWeek) that the
// Lesson Plan Studio already stamps. The teacher then records coverage/remarks
// against what was planned, instead of starting from a blank grid.
//
// No Firebase/DOM here — the studio passes in the generations + calendar week
// skeleton it already has. Row shape matches src/utils/recordOfWork.js exactly.
//
// Run tests: npm run test:record-of-work-planning

import { normSubject, normGrade, termNumberOf } from '../../../utils/prepareThisWeek.js'

function toMs(t) {
  if (!t) return 0
  if (typeof t.toDate === 'function') return t.toDate().getTime()
  const n = new Date(t).getTime()
  return Number.isFinite(n) ? n : 0
}

/**
 * Index the teacher's lesson plans for one term by their planned school week.
 * Matching is scoped by grade + subject (via meta.planned first, then inputs)
 * + term + ACADEMIC YEAR — a 2025 plan never seeds a 2026 record. Only
 * meta.planned.schoolWeek attributes a plan to a week (never createdAt/
 * updatedAt/array position); legacy plans without it are simply not indexed —
 * their weeks stay blank for manual entry.
 *
 * When several plans land on the same week, the winner is deterministic per the
 * statutory-record rule: the EARLIEST planned lesson in that school week, tie-
 * broken by stable document id — never Firestore return order. A week whose
 * candidates carry genuinely different topics is flagged (`conflict: true`) so
 * the caller can tell the teacher to review it rather than trust a silent pick.
 *
 * @returns {Map<number, {week, topic, subtopic, plannedDate, sourceLessonPlanId, conflict}>}
 */
export function plannedLessonsForTerm(
  generations,
  { grade = '', subject = '', termNumber = null, academicYear = '' } = {},
) {
  const wantGrade = normGrade(grade)
  const wantSubject = normSubject(subject)
  const wantYear = String(academicYear || '').trim()
  const candidates = new Map() // week → [{ plan fields }]

  for (const g of Array.isArray(generations) ? generations : []) {
    if (!g || g.tool !== 'lesson_plan') continue
    const planned = g.meta && typeof g.meta.planned === 'object' ? g.meta.planned : {}
    const gGrade = normGrade(planned.grade || g.inputs?.grade || '')
    const gSubject = normSubject(planned.subject || g.inputs?.subject || '')
    if (wantGrade && gGrade !== wantGrade) continue
    if (wantSubject && gSubject !== wantSubject) continue
    const gTerm = termNumberOf(planned.termNumber ?? g.inputs?.term)
    if (termNumber != null && gTerm !== termNumber) continue
    // Year boundary: modern planned metadata always carries academicYear
    // alongside schoolWeek; a plan that can't prove its year must not seed.
    if (wantYear && String(planned.academicYear || '').trim() !== wantYear) continue

    const week = Number(planned.schoolWeek)
    if (!Number.isInteger(week) || week < 1) continue

    const entry = {
      week,
      topic: String(g.inputs?.topic || '').trim(),
      subtopic: String(g.inputs?.subtopic || '').trim(),
      plannedDate: planned.plannedDate || '',
      sourceLessonPlanId: g.id || '',
      createdMs: toMs(g.createdAt),
    }
    if (!candidates.has(week)) candidates.set(week, [])
    candidates.get(week).push(entry)
  }

  const byWeek = new Map()
  for (const [week, list] of candidates) {
    // Earliest planned lesson in the week wins; '' (no date) sorts last;
    // stable document-id tie-breaker.
    const sorted = [...list].sort((a, b) =>
      (a.plannedDate || '9999-99-99').localeCompare(b.plannedDate || '9999-99-99') ||
      String(a.sourceLessonPlanId).localeCompare(String(b.sourceLessonPlanId)),
    )
    const winner = sorted[0]
    const topics = new Set(list.map((e) => e.topic).filter(Boolean))
    byWeek.set(week, {
      week,
      topic: winner.topic,
      subtopic: winner.subtopic,
      plannedDate: winner.plannedDate,
      sourceLessonPlanId: winner.sourceLessonPlanId,
      conflict: topics.size > 1,
    })
  }
  return byWeek
}

/**
 * Restore studio state from a SAVED Record of Work generation (opened by id).
 * The stored document is authoritative: header and weeks come from it verbatim
 * (normalized to the studio's shapes) — never from the Teaching Profile or the
 * Dashboard's active assignment. Returns null for anything that isn't a loadable
 * record (wrong tool, missing output/weeks) so the caller can show a safe
 * not-found state instead of hydrating garbage.
 */
export function restoreRecordFromGeneration(gen) {
  if (!gen || typeof gen !== 'object') return null
  if (gen.tool !== 'record_of_work') return null
  const out = gen.output && typeof gen.output === 'object' ? gen.output : null
  if (!out || !Array.isArray(out.weeks) || !out.weeks.length) return null
  const h = out.header && typeof out.header === 'object' ? out.header : {}
  const header = {
    school: String(h.school || ''),
    teacherName: String(h.teacherName || ''),
    grade: String(h.grade || ''),
    subject: String(h.subject || ''),
    term: Number(h.term) >= 1 && Number(h.term) <= 3 ? Number(h.term) : 1,
    year: String(h.year || ''),
  }
  // Preserve every stored row field (incl. sourceLessonPlanId) while guaranteeing
  // the studio's editable shape.
  const weeks = out.weeks.map((w) => ({
    ...(w && typeof w === 'object' ? w : {}),
    week: String(w?.week ?? ''),
    weekEnding: String(w?.weekEnding ?? ''),
    topic: String(w?.topic ?? ''),
    subtopic: String(w?.subtopic ?? ''),
    workDone: Array.isArray(w?.workDone) ? w.workDone : [],
    coverage: String(w?.coverage ?? ''),
    remarks: String(w?.remarks ?? ''),
  }))
  return { header, weeks }
}

/** True when a record week row carries any teacher content worth preserving. */
export function recordWeekHasContent(w) {
  if (!w || typeof w !== 'object') return false
  return Boolean(
    String(w.topic || '').trim() ||
    String(w.subtopic || '').trim() ||
    (Array.isArray(w.workDone) && w.workDone.length) ||
    String(w.coverage || '').trim() ||
    String(w.remarks || '').trim(),
  )
}

/**
 * Build Record of Work week rows from a calendar week skeleton, pre-filling the
 * planned topic/subtopic for weeks that have a lesson plan. Coverage/remarks are
 * left blank for the teacher to record. Row shape = blankRecordWeek's shape,
 * plus `sourceLessonPlanId` on seeded rows (a reference only — the row stays
 * fully editable, and a later-deleted plan never erases record content).
 *
 * Seeding NEVER overwrites teacher content: an `existingWeeks` row with any
 * content keeps every teacher value; only its blank topic/subtopic/weekEnding
 * are filled in.
 *
 * @param termWeeks     getTermWeeks() → [{ weekNumber, ending, endingLabel }]
 * @param plannedByWeek plannedLessonsForTerm() result
 * @param existingWeeks the studio's current week rows (may hold typed work)
 */
export function buildRecordWeeksFromCalendar({ termWeeks = [], plannedByWeek = new Map(), existingWeeks = [] } = {}) {
  const existingByWeek = new Map(
    (Array.isArray(existingWeeks) ? existingWeeks : [])
      .filter((w) => recordWeekHasContent(w))
      .map((w) => [Number(w.week), w]),
  )
  return (Array.isArray(termWeeks) ? termWeeks : []).map((w) => {
    const planned = plannedByWeek instanceof Map ? plannedByWeek.get(w.weekNumber) : null
    const existing = existingByWeek.get(w.weekNumber)
    if (existing) {
      // Teacher-entered content wins; fill only the blanks.
      const topicFromPlan = !String(existing.topic || '').trim() && planned?.topic
      return {
        ...existing,
        week: String(w.weekNumber),
        weekEnding: String(existing.weekEnding || '').trim() || w.endingLabel || w.ending || '',
        topic: String(existing.topic || '').trim() || (planned ? planned.topic : ''),
        subtopic: String(existing.subtopic || '').trim() || (planned ? planned.subtopic : ''),
        ...(topicFromPlan && planned.sourceLessonPlanId ? { sourceLessonPlanId: planned.sourceLessonPlanId } : {}),
      }
    }
    return {
      week: String(w.weekNumber),
      weekEnding: w.endingLabel || w.ending || '',
      topic: planned ? planned.topic : '',
      subtopic: planned ? planned.subtopic : '',
      workDone: [],
      coverage: '',
      remarks: '',
      ...(planned?.topic && planned.sourceLessonPlanId ? { sourceLessonPlanId: planned.sourceLessonPlanId } : {}),
    }
  })
}

/**
 * One call for the studio: calendar week skeleton + lesson-plan topics → record
 * week rows. Also reports how many weeks were pre-filled from a plan, how many
 * kept teacher-entered content, and which weeks had MORE than one distinct
 * planned topic (the teacher should review those — never silently trusted).
 */
export function buildRecordOfWorkFromPlan({
  generations = [], termWeeks = [], existingWeeks = [],
  grade = '', subject = '', termNumber = null, academicYear = '',
} = {}) {
  const plannedByWeek = plannedLessonsForTerm(generations, { grade, subject, termNumber, academicYear })
  const weeks = buildRecordWeeksFromCalendar({ termWeeks, plannedByWeek, existingWeeks })
  const preservedWeeks = new Set(
    (Array.isArray(existingWeeks) ? existingWeeks : [])
      .filter((w) => recordWeekHasContent(w))
      .map((w) => Number(w.week)),
  )
  const plannedCount = weeks.filter((w) => w.topic && !preservedWeeks.has(Number(w.week))).length
  const conflictWeeks = [...plannedByWeek.values()].filter((p) => p.conflict).map((p) => p.week).sort((a, b) => a - b)
  return { weeks, plannedCount, preservedCount: preservedWeeks.size, conflictWeeks }
}
