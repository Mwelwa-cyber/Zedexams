// Central attendance-status configuration for the Class Register Studio.
// Every surface (mobile daily register, term grid, summaries, print views,
// exports) must read labels/symbols/colours/calculation treatment from here —
// never duplicate these per-component.
//
// Calculation treatment flags:
//   countsAsAttended — contributes to the attendance-percentage numerator
//                      (late counts as present per Zambian register practice,
//                      but is still totalled separately).
//   countsAsAbsence  — an absence variant (sick/excused stay separate from
//                      plain absent in totals, but all reduce the percentage
//                      under the default policy).
//   eligible         — the date counts toward the learner's eligible school
//                      days. "not_applicable" removes the day entirely.

export const ATTENDANCE_STATUSES = {
  present: {
    id: 'present',
    label: 'Present',
    shortLabel: 'Present',
    symbol: 'P',
    countsAsAttended: true,
    countsAsAbsence: false,
    eligible: true,
    // Tailwind classes for chips/cells; keep in sync with the print palette below.
    chipClass: 'bg-green-100 text-green-800 border-green-300',
    activeClass: 'bg-green-600 text-white border-green-600',
    dotClass: 'bg-green-500',
    printColor: '#15803d',
    screenColor: 'var(--att-present-fg, #15803d)',
  },
  absent: {
    id: 'absent',
    label: 'Absent',
    shortLabel: 'Absent',
    symbol: 'A',
    countsAsAttended: false,
    countsAsAbsence: true,
    eligible: true,
    chipClass: 'bg-red-100 text-red-800 border-red-300',
    activeClass: 'bg-red-600 text-white border-red-600',
    dotClass: 'bg-red-500',
    printColor: '#b91c1c',
    screenColor: 'var(--att-absent-fg, #b91c1c)',
  },
  sick: {
    id: 'sick',
    label: 'Sick',
    shortLabel: 'Sick',
    symbol: 'S',
    countsAsAttended: false,
    countsAsAbsence: true,
    eligible: true,
    chipClass: 'bg-blue-100 text-blue-800 border-blue-300',
    activeClass: 'bg-blue-600 text-white border-blue-600',
    dotClass: 'bg-blue-500',
    printColor: '#1d4ed8',
    screenColor: 'var(--att-sick-fg, #1d4ed8)',
  },
  late: {
    id: 'late',
    label: 'Late',
    shortLabel: 'Late',
    symbol: 'L',
    countsAsAttended: true, // late counts as present in the percentage…
    countsAsAbsence: false, // …but is totalled separately everywhere.
    eligible: true,
    chipClass: 'bg-amber-100 text-amber-800 border-amber-300',
    activeClass: 'bg-amber-500 text-white border-amber-500',
    dotClass: 'bg-amber-500',
    printColor: '#b45309',
    screenColor: 'var(--att-late-fg, #b45309)',
  },
  excused: {
    id: 'excused',
    label: 'Excused',
    shortLabel: 'Excused',
    symbol: 'E',
    countsAsAttended: false,
    countsAsAbsence: true,
    eligible: true,
    chipClass: 'bg-purple-100 text-purple-800 border-purple-300',
    activeClass: 'bg-purple-600 text-white border-purple-600',
    dotClass: 'bg-purple-500',
    printColor: '#7e22ce',
    screenColor: 'var(--att-excused-fg, #7e22ce)',
  },
  not_applicable: {
    id: 'not_applicable',
    label: 'Not applicable',
    shortLabel: 'N/A',
    symbol: '–',
    countsAsAttended: false,
    countsAsAbsence: false,
    eligible: false, // removes the day from the learner's eligible total
    chipClass: 'bg-gray-100 text-gray-600 border-gray-300',
    activeClass: 'bg-gray-500 text-white border-gray-500',
    dotClass: 'bg-gray-400',
    printColor: '#4b5563',
    screenColor: 'var(--zt-text-muted, #4b5563)',
  },
};

// Display/tap order for pickers, legends and print keys.
export const ATTENDANCE_STATUS_ORDER = ['present', 'absent', 'sick', 'late', 'excused', 'not_applicable'];

// Statuses a teacher can set from the register UI (all of them — N/A is how a
// teacher excludes a learner from a day, e.g. an exam-only session).
export const MARKABLE_STATUSES = ATTENDANCE_STATUS_ORDER;

export const VALID_STATUS_IDS = new Set(ATTENDANCE_STATUS_ORDER);

export function isValidStatus(status) {
  return VALID_STATUS_IDS.has(status);
}

export function getStatusConfig(status) {
  return ATTENDANCE_STATUSES[status] || null;
}

export function statusSymbol(status) {
  return ATTENDANCE_STATUSES[status]?.symbol ?? '';
}

// Calendar-day classifications (school calendar is the source of truth).
export const DAY_CLASSIFICATIONS = {
  teaching_day: { id: 'teaching_day', label: 'Teaching day', markable: true },
  non_teaching_day: { id: 'non_teaching_day', label: 'Non-teaching day', markable: false },
  half_day: { id: 'half_day', label: 'Half day', markable: true },
  school_closure: { id: 'school_closure', label: 'School closure', markable: false },
  optional_attendance_day: { id: 'optional_attendance_day', label: 'Optional attendance day', markable: true },
};

export const VALID_DAY_CLASSIFICATIONS = new Set(Object.keys(DAY_CLASSIFICATIONS));

/**
 * What each server rejection code means, in words a teacher can act on.
 *
 * Declared HERE rather than in attendanceService.js, which it used to share a
 * file with: this is a table of copy with no Firestore in it, and living
 * behind the Firestore client meant that any component wanting to show a
 * rejection message pulled the whole Firebase SDK in behind it — including
 * under test, where there is no config and the import throws. attendanceService
 * re-exports it, so no caller had to change.
 */
export const ATTENDANCE_ERROR_MESSAGES = {
  TERM_LOCKED: 'This term’s register is locked — ask an administrator to reopen it. Your changes are kept until then.',
  TERM_MISMATCH: 'The selected term doesn’t match this date. Re-select the term and try again.',
  DATE_OUTSIDE_TERM: 'This date falls outside the term, so it can’t be marked.',
  NON_TEACHING_DAY: 'This date isn’t a teaching day (weekend, holiday or closure).',
  FUTURE_DATE: 'This date is in the future — the register opens on the day.',
  TEACHER_NOT_ASSIGNED: 'You’re not assigned to this class, so the server refused the change.',
  INVALID_ATTENDANCE_STATUS: 'One of the marks had an invalid status and was refused.',
  LEARNER_NOT_IN_CLASS: 'A learner in this change is not on the class roster.',
  LEARNER_NOT_ELIGIBLE: 'A learner in this change was not enrolled on this date.',
  STALE_VERSION: 'Someone else updated this day first — reviewing their changes…',
  INVALID_ARGUMENT: 'The change couldn’t be understood by the server.',
  NETWORK: 'No connection — the change is saved on this device and will sync when you’re back online.',
};

// Register lifecycle states for a class+term register.
export const REGISTER_STATES = {
  draft: { id: 'draft', label: 'Draft', editable: true },
  submitted: { id: 'submitted', label: 'Submitted', editable: true },
  locked: { id: 'locked', label: 'Locked', editable: false },
  reopened: { id: 'reopened', label: 'Reopened', editable: true },
};

// Default calculation policy. Schools can override pieces of this later
// (stored on the term register settings doc); the calculator accepts the
// merged object so behaviour is configurable without code changes.
export const DEFAULT_ATTENDANCE_POLICY = {
  // Statuses whose days count in the percentage numerator.
  attendedStatuses: ['present', 'late'],
  // Whether excused absence should count as attended (some schools do).
  excusedCountsAsAttended: false,
  // Weight applied to half_day dates in both numerator and denominator.
  halfDayWeight: 1,
  // Whether unmarked eligible days count against the learner (in the
  // denominator). Official registers count every eligible day.
  unmarkedCountsInDenominator: true,
  // Warn in summaries when a learner's percentage falls below this.
  warningThresholdPercent: 80,
};

export function resolveAttendancePolicy(overrides) {
  const policy = { ...DEFAULT_ATTENDANCE_POLICY, ...(overrides || {}) };
  const attended = new Set(policy.attendedStatuses || DEFAULT_ATTENDANCE_POLICY.attendedStatuses);
  if (policy.excusedCountsAsAttended) attended.add('excused');
  return { ...policy, attendedSet: attended };
}
