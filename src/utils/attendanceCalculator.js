// Pure attendance mathematics for the Class Register Studio.
// No React, no Firestore — everything here is deterministic and unit-tested
// under plain node (scripts/test-attendance-calculator.mjs). On-screen totals,
// print views and exports must all call these functions so they can never
// disagree.
//
// Shared shapes:
//   term    — { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }
//   day     — { date: 'YYYY-MM-DD', classification, records?: { [learnerId]: { status, note } } }
//   learner — { id, joinedClassOn?, leftClassOn?, gender?, enrolmentStatus? }
//   policy  — see DEFAULT_ATTENDANCE_POLICY in attendanceConstants.js
//
// ISO date strings compare correctly with < / > so no Date parsing is needed
// for ordering (and no timezone drift is possible).

import { ATTENDANCE_STATUSES, resolveAttendancePolicy } from './attendanceConstants.js';

const EMPTY_TOTALS = Object.freeze({
  eligibleDays: 0,
  presentDays: 0,
  absentDays: 0,
  sickDays: 0,
  lateDays: 0,
  excusedDays: 0,
  notApplicableDays: 0,
  unmarkedDays: 0,
  attendedDays: 0,
  attendancePercentage: null,
});

const STATUS_TOTAL_KEYS = {
  present: 'presentDays',
  absent: 'absentDays',
  sick: 'sickDays',
  late: 'lateDays',
  excused: 'excusedDays',
  not_applicable: 'notApplicableDays',
};

/**
 * The window of term dates a learner is enrolled for. Eligibility begins on
 * the later of the term start and joinedClassOn, and ends on the earlier of
 * the term end and leftClassOn. Legacy learners without enrolment dates get
 * the whole term.
 */
export function learnerEligibilityWindow(learner, term) {
  if (!term?.startDate || !term?.endDate) return null;
  let start = term.startDate;
  let end = term.endDate;
  if (learner?.joinedClassOn && learner.joinedClassOn > start) start = learner.joinedClassOn;
  if (learner?.leftClassOn && learner.leftClassOn < end) end = learner.leftClassOn;
  if (start > end) return null; // joined after leaving / outside the term entirely
  return { start, end };
}

export function isLearnerEligibleOn(learner, date, term) {
  const window = learnerEligibilityWindow(learner, term);
  if (!window) return false;
  return date >= window.start && date <= window.end;
}

function dayWeight(day, policy) {
  return day.classification === 'half_day' ? policy.halfDayWeight : 1;
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

/** Format a percentage (or null) for display, one decimal place. */
export function formatPercent(percentage) {
  if (percentage == null || Number.isNaN(percentage)) return '—';
  return `${roundPercent(percentage).toFixed(1)}%`;
}

/**
 * Totals for one learner across the supplied teaching days.
 * Days outside the learner's eligibility window are ignored entirely (a
 * learner who joined mid-term is never "absent" before joining). Days marked
 * not_applicable are removed from the eligible total. Optional-attendance
 * days only count when the learner was actually marked.
 */
export function computeLearnerTotals({ learner, days, term, policy: policyOverrides }) {
  const policy = resolveAttendancePolicy(policyOverrides);
  const window = learnerEligibilityWindow(learner, term);
  const totals = { ...EMPTY_TOTALS };
  if (!window || !Array.isArray(days)) return totals;

  let eligibleWeighted = 0;
  let attendedWeighted = 0;

  for (const day of days) {
    if (!day?.date || day.date < window.start || day.date > window.end) continue;
    const record = day.records?.[learner.id];
    const status = record?.status;
    const config = status ? ATTENDANCE_STATUSES[status] : null;

    if (config && !config.eligible) {
      totals.notApplicableDays += 1;
      continue;
    }
    if (!config && day.classification === 'optional_attendance_day' && !policy.optionalDayCountsWhenUnmarked) {
      continue; // unmarked optional day: not part of this learner's eligible total
    }

    const weight = dayWeight(day, policy);
    if (!config) {
      totals.unmarkedDays += 1;
      if (!policy.unmarkedCountsInDenominator) continue;
      eligibleWeighted += weight;
      continue;
    }

    totals[STATUS_TOTAL_KEYS[status]] += 1;
    eligibleWeighted += weight;
    if (policy.attendedSet.has(status)) attendedWeighted += weight;
  }

  totals.eligibleDays = eligibleWeighted;
  totals.attendedDays = attendedWeighted;
  totals.attendancePercentage = eligibleWeighted > 0
    ? (attendedWeighted / eligibleWeighted) * 100
    : null; // never divide by zero — display layers render '—'
  return totals;
}

/** Per-status counts for one day's records map (stored on the day doc). */
export function computeDailyCounts(records) {
  const counts = { present: 0, absent: 0, sick: 0, late: 0, excused: 0, not_applicable: 0, marked: 0 };
  for (const record of Object.values(records || {})) {
    const status = record?.status;
    if (status && Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
      counts.marked += 1;
    }
  }
  return counts;
}

function monthKey(date) {
  return date.slice(0, 7); // YYYY-MM
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthLabel(key) {
  const month = Number(key.slice(5, 7));
  return MONTH_LABELS[month - 1] || key;
}

/**
 * Whole-class rollup: enrolment, today's counts, aggregate attendance,
 * threshold lists and the monthly trend. `days` should already be limited to
 * resolved teaching dates (see attendanceCalendarResolver) up to today.
 */
export function computeClassSummary({ learners, days, term, policy: policyOverrides, todayIso }) {
  const policy = resolveAttendancePolicy(policyOverrides);
  const list = Array.isArray(learners) ? learners : [];
  // Roster docs carry `status` ('active'|'transferred'|'inactive'); accept
  // `enrolmentStatus` too for callers that already adapted the shape.
  const activeLearners = list.filter((l) => (l.enrolmentStatus || l.status || 'active') === 'active');

  const perLearner = list.map((learner) => ({
    learner,
    totals: computeLearnerTotals({ learner, days, term, policy }),
  }));

  let possible = 0;
  let actual = 0;
  let totalAbsences = 0;
  let totalSickDays = 0;
  const belowThreshold = [];
  const perfectAttendance = [];
  const threshold = policy.warningThresholdPercent;

  for (const { learner, totals } of perLearner) {
    possible += totals.eligibleDays;
    actual += totals.attendedDays;
    totalAbsences += totals.absentDays + totals.sickDays + totals.excusedDays;
    totalSickDays += totals.sickDays;
    if (totals.attendancePercentage != null) {
      if (totals.attendancePercentage < threshold) {
        belowThreshold.push({ learnerId: learner.id, percentage: totals.attendancePercentage });
      }
      if (totals.attendancePercentage >= 100 && totals.unmarkedDays === 0) {
        perfectAttendance.push(learner.id);
      }
    }
  }

  const averageAttendancePercentage = possible > 0 ? (actual / possible) * 100 : null;

  // Today's snapshot — only learners eligible today are counted as unmarked.
  const todayDay = todayIso ? days.find((d) => d.date === todayIso) : null;
  const todayCounts = { present: 0, absent: 0, sick: 0, late: 0, excused: 0, not_applicable: 0, unmarked: 0, eligible: 0 };
  if (todayIso) {
    for (const learner of activeLearners) {
      if (!isLearnerEligibleOn(learner, todayIso, term)) continue;
      todayCounts.eligible += 1;
      const status = todayDay?.records?.[learner.id]?.status;
      if (status && Object.prototype.hasOwnProperty.call(todayCounts, status)) {
        todayCounts[status] += 1;
      } else {
        todayCounts.unmarked += 1;
      }
    }
  }

  // Monthly trend: aggregate attended/eligible ratio across all learners.
  const monthTotals = new Map();
  for (const day of days) {
    const key = monthKey(day.date);
    if (!monthTotals.has(key)) monthTotals.set(key, { possible: 0, actual: 0 });
  }
  for (const { learner } of perLearner) {
    for (const day of days) {
      if (!isLearnerEligibleOn(learner, day.date, term)) continue;
      const bucket = monthTotals.get(monthKey(day.date));
      const status = day.records?.[learner.id]?.status;
      const config = status ? ATTENDANCE_STATUSES[status] : null;
      if (config && !config.eligible) continue;
      if (!config && day.classification === 'optional_attendance_day' && !policy.optionalDayCountsWhenUnmarked) continue;
      if (!config && !policy.unmarkedCountsInDenominator) continue;
      const weight = dayWeight(day, policy);
      bucket.possible += weight;
      if (config && policy.attendedSet.has(status)) bucket.actual += weight;
    }
  }
  const monthlyTrend = [...monthTotals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, bucket]) => ({
      month: key,
      label: monthLabel(key),
      percentage: bucket.possible > 0 ? (bucket.actual / bucket.possible) * 100 : null,
    }));

  const genderOf = (l) => (l.gender || '').trim().toUpperCase().charAt(0);

  return {
    enrolment: activeLearners.length,
    boys: activeLearners.filter((l) => genderOf(l) === 'M').length,
    girls: activeLearners.filter((l) => genderOf(l) === 'F').length,
    todayCounts,
    averageAttendancePercentage,
    possibleAttendance: possible,
    actualAttendance: actual,
    totalAbsences,
    totalSickDays,
    belowThreshold,
    perfectAttendance,
    monthlyTrend,
    perLearner,
    warningThresholdPercent: threshold,
  };
}
