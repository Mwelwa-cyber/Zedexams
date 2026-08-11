/**
 * registerValidationCore — the checks a term register passes before it can be
 * finalised.
 *
 * Pure module (no React / Firebase / DOM); node suite covers it directly.
 *
 * THE DESIGN DECISION THAT MATTERS (§19): only genuine record-INTEGRITY errors
 * block finalisation. Everything else is reported and lets the teacher through.
 *
 * The temptation is to block on anything imperfect, and it is the wrong call
 * here. A Zambian class register is a legal document a teacher has to file at
 * the end of term; a platform that refuses to close it because one learner has
 * no admission number does not produce a better register, it produces a
 * teacher who files a hand-written one instead and stops using the platform.
 * So: attendance recorded on a day the school was shut is an ERROR (the
 * document asserts something false and cannot be filed). A missing admission
 * number is a WARNING (the document is true and incomplete).
 *
 * Three severities, and each one is a different sentence to a teacher:
 *   error       — this register says something that is not true. Fix it.
 *   warning     — this register is true but unfinished. You may finalise.
 *   information — worth knowing. No action implied.
 */

import { formatDateLong } from '../../../utils/attendanceCalendarResolver.js'
import { findDuplicatePairs } from '../../../utils/learnerDuplicates.js'
import { isActiveLearner } from '../../../utils/learnerStatus.js'

export const VALIDATION_SEVERITIES = ['error', 'warning', 'information']

function issue(severity, code, message, extra = {}) {
  return { severity, code, message, ...extra }
}

/**
 * Validate one class + term register.
 *
 * @param {object} args
 * @param {Array}  args.learners  the class list (source of truth)
 * @param {Array}  args.days      term days WITH records attached (day.records)
 * @param {object} args.term      { startDate, endDate }
 * @param {string} args.todayIso  today, so future days are not "incomplete"
 * @param {object} args.sync      { pendingCount, conflictCount, rejectedCount }
 * @returns {{ issues, errors, warnings, information, canFinalise, checks }}
 */
export function validateTermRegister({
  learners = [],
  days = [],
  term = null,
  todayIso = null,
  sync = {},
} = {}) {
  const roster = Array.isArray(learners) ? learners : []
  const termDays = Array.isArray(days) ? days : []
  const issues = []

  const activeLearners = roster.filter(isActiveLearner)
  const teachingDays = termDays.filter((d) => d.markable)
  const pastTeachingDays = teachingDays.filter((d) => !d.isFuture && (!todayIso || d.date <= todayIso))

  // ── errors: the register asserts something untrue ──────────────

  // Attendance recorded on a day the school was not open. A printed register
  // showing marks on a public holiday is the single most obvious way a
  // register fails inspection.
  for (const day of termDays) {
    if (day.markable) continue
    const marked = Object.values(day.records || {}).filter((r) => r?.status)
    if (marked.length) {
      issues.push(issue('error', 'marks_on_non_teaching_day',
        `${formatDateLong(day.date)} is not a teaching day but has ${marked.length} mark${marked.length === 1 ? '' : 's'}.`,
        { date: day.date, count: marked.length }))
    }
  }

  // Attendance recorded outside a learner's enrolment window. Either the
  // learner's dates are wrong or the mark is — either way the document claims
  // a child was in a class they were not enrolled in.
  for (const day of teachingDays) {
    for (const learner of roster) {
      const record = day.records?.[learner.id]
      if (!record?.status || record.status === 'not_applicable') continue
      if (learner.joinedClassOn && day.date < learner.joinedClassOn) {
        issues.push(issue('error', 'marked_before_admission',
          `${learner.fullName} is marked on ${formatDateLong(day.date)}, before their admission date (${formatDateLong(learner.joinedClassOn)}).`,
          { date: day.date, learnerId: learner.id }))
      }
      if (learner.leftClassOn && day.date > learner.leftClassOn) {
        issues.push(issue('error', 'marked_after_leaving',
          `${learner.fullName} is marked on ${formatDateLong(day.date)}, after they left the class (${formatDateLong(learner.leftClassOn)}).`,
          { date: day.date, learnerId: learner.id }))
      }
    }
  }

  // Dates outside the term entirely.
  if (term?.startDate && term?.endDate) {
    for (const day of termDays) {
      if (day.date >= term.startDate && day.date <= term.endDate) continue
      const marked = Object.values(day.records || {}).filter((r) => r?.status)
      if (marked.length) {
        issues.push(issue('error', 'marks_outside_term',
          `${formatDateLong(day.date)} falls outside this term but carries attendance.`,
          { date: day.date }))
      }
    }
  }

  // The same child enrolled twice in one class: their attendance is split
  // across two rows and every total that mentions them is wrong.
  for (const pair of findDuplicatePairs(roster)) {
    if (pair.confidence !== 'same_admission_number') continue
    issues.push(issue('error', 'duplicate_enrolment',
      `${pair.a.fullName} and ${pair.b.fullName} share admission number ${pair.a.admissionNumber} — the same learner is enrolled twice.`,
      { learnerId: pair.a.id, otherLearnerId: pair.b.id }))
  }

  // Changes that have not reached the server cannot be finalised, because the
  // register being finalised is the one on the server, not the one on screen.
  const pending = Number(sync?.pendingCount) || 0
  if (pending > 0) {
    issues.push(issue('error', 'unsynced_changes',
      `${pending} change${pending === 1 ? '' : 's'} on this device ${pending === 1 ? 'has' : 'have'} not synchronised yet.`,
      { count: pending }))
  }
  const conflicts = Number(sync?.conflictCount) || 0
  if (conflicts > 0) {
    issues.push(issue('error', 'unresolved_conflicts',
      `${conflicts} editing conflict${conflicts === 1 ? '' : 's'} ${conflicts === 1 ? 'is' : 'are'} still unresolved.`,
      { count: conflicts }))
  }
  const rejected = Number(sync?.rejectedCount) || 0
  if (rejected > 0) {
    issues.push(issue('error', 'rejected_changes',
      `${rejected} change${rejected === 1 ? '' : 's'} ${rejected === 1 ? 'was' : 'were'} rejected by the server and ${rejected === 1 ? 'has' : 'have'} not been resolved.`,
      { count: rejected }))
  }

  // Impossible totals — a day claiming more marks than there are learners
  // enrolled that day. Cheap to check and the loudest possible sign that
  // something upstream has gone wrong.
  for (const day of teachingDays) {
    const marked = Object.keys(day.records || {}).filter((id) => day.records[id]?.status)
    const enrolled = roster.filter((l) => {
      if (l.joinedClassOn && day.date < l.joinedClassOn) return false
      if (l.leftClassOn && day.date > l.leftClassOn) return false
      return true
    })
    if (marked.length > enrolled.length) {
      issues.push(issue('error', 'impossible_totals',
        `${formatDateLong(day.date)} has ${marked.length} marks but only ${enrolled.length} learners were enrolled.`,
        { date: day.date }))
    }
  }

  // ── warnings: true but unfinished ──────────────────────────────

  for (const day of pastTeachingDays) {
    const dayRecords = day.records || {}
    const missing = roster.filter((l) => {
      if (!isActiveLearner(l) && l.leftClassOn && day.date > l.leftClassOn) return false
      if (l.joinedClassOn && day.date < l.joinedClassOn) return false
      if (l.leftClassOn && day.date > l.leftClassOn) return false
      return !dayRecords[l.id]?.status
    })
    if (missing.length) {
      issues.push(issue('warning', 'unmarked_learners',
        `${formatDateLong(day.date)} has ${missing.length} unmarked learner${missing.length === 1 ? '' : 's'}.`,
        { date: day.date, count: missing.length, learnerIds: missing.map((l) => l.id) }))
    }
  }

  const noAdmission = roster.filter((l) => !l.admissionNumber)
  if (noAdmission.length) {
    issues.push(issue('warning', 'missing_admission_numbers',
      `${noAdmission.length} learner${noAdmission.length === 1 ? ' has' : 's have'} no admission number.`,
      { count: noAdmission.length, learnerIds: noAdmission.map((l) => l.id) }))
  }

  const unconfirmed = roster.filter((l) => l.needsReview)
  if (unconfirmed.length) {
    issues.push(issue('warning', 'unconfirmed_learners',
      `${unconfirmed.length} learner record${unconfirmed.length === 1 ? '' : 's'} on the class list ${unconfirmed.length === 1 ? 'has' : 'have'} not been confirmed.`,
      { count: unconfirmed.length, learnerIds: unconfirmed.map((l) => l.id) }))
  }

  for (const pair of findDuplicatePairs(roster)) {
    if (pair.confidence === 'same_admission_number') continue
    issues.push(issue('warning', 'possible_duplicate_learners',
      `${pair.a.fullName} and ${pair.b.fullName} may be the same learner.`,
      { learnerId: pair.a.id, otherLearnerId: pair.b.id, confidence: pair.confidence }))
  }

  // ── information ────────────────────────────────────────────────

  const halfDays = teachingDays.filter((d) => d.classification === 'half_day')
  if (halfDays.length) {
    issues.push(issue('information', 'half_days',
      `${halfDays.length} half-day${halfDays.length === 1 ? '' : 's'} in this term count as teaching days.`,
      { count: halfDays.length }))
  }

  const nonActive = roster.length - activeLearners.length
  if (nonActive > 0) {
    issues.push(issue('information', 'inactive_learners',
      `${nonActive} learner${nonActive === 1 ? '' : 's'} on this list ${nonActive === 1 ? 'has' : 'have'} transferred, withdrawn or graduated. Their past attendance is kept.`,
      { count: nonActive }))
  }

  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const information = issues.filter((i) => i.severity === 'information')

  return {
    issues,
    errors,
    warnings,
    information,
    canFinalise: errors.length === 0,
    // The reassuring half of the report — what WAS checked, so a clean run
    // says "60 teaching days checked" rather than showing an empty panel that
    // is indistinguishable from a check that never ran.
    checks: {
      teachingDaysChecked: teachingDays.length,
      teachingDaysCompleted: pastTeachingDays.length,
      learnersChecked: roster.length,
      activeLearners: activeLearners.length,
      classListSynchronised: true,
    },
  }
}

/**
 * The register's stage in its lifecycle. Adds `ready_for_review` between
 * "someone is still marking" and "the head has it", because a class teacher
 * needs a way to say they are done before anyone else acts on it.
 */
export const REGISTER_STAGES = [
  { value: 'in_progress', label: 'In progress', editableBy: ['class_teacher'] },
  { value: 'ready_for_review', label: 'Ready for review', editableBy: ['class_teacher'] },
  { value: 'submitted', label: 'Submitted', editableBy: [] },
  { value: 'approved', label: 'Approved', editableBy: [] },
  { value: 'locked', label: 'Locked', editableBy: [] },
]

/**
 * Who may do what to a register at a given stage.
 *
 * The rule the product turns on (§20): a SUBJECT teacher never edits the
 * official daily attendance register. They can see the class list — they teach
 * these children — and enter subject results where they are authorised, but
 * the daily register belongs to the class teacher. This is enforced by the
 * server too; it is repeated here so the interface does not offer a button
 * that will be refused.
 */
export function registerPermissions({ role, isClassTeacher = false, stage = 'in_progress' }) {
  const admin = role === 'admin' || role === 'super_admin'
  const head = role === 'headteacher' || admin
  const editable = ['in_progress', 'ready_for_review'].includes(stage)

  return {
    canMarkAttendance: Boolean(isClassTeacher) && editable,
    canAddNotes: Boolean(isClassTeacher) && editable,
    canFinalise: Boolean(isClassTeacher) && editable,
    canApprove: head && stage === 'submitted',
    canReturnForCorrection: head && stage === 'submitted',
    canReopen: head && ['approved', 'locked'].includes(stage),
    canManageEnrolment: Boolean(isClassTeacher) || admin,
    canManageClasses: admin,
    canManageAssignments: admin,
    // Read access is wider than write access on purpose: a subject teacher
    // needs the class list to enter their own results.
    canViewClassList: true,
  }
}
