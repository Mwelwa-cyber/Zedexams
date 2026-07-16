// Plain-node tests for the Class Register attendance calculation engine.
// Run: npm run test:attendance-calc  (auto-discovered by run-all-tests.mjs)
import assert from 'node:assert/strict';
import {
  learnerEligibilityWindow,
  isLearnerEligibleOn,
  computeLearnerTotals,
  computeDailyCounts,
  computeClassSummary,
  formatPercent,
} from '../src/utils/attendanceCalculator.js';
import { resolveAttendancePolicy, isValidStatus, ATTENDANCE_STATUSES, ATTENDANCE_STATUS_ORDER } from '../src/utils/attendanceConstants.js';

const TERM = { startDate: '2026-05-04', endDate: '2026-05-29' };

function day(date, records = {}, classification = 'teaching_day') {
  return { date, classification, records };
}
function rec(status) {
  return { status, note: '' };
}

// Mon-Fri teaching days for two weeks in May 2026 (4th-8th, 11th-15th).
const TWO_WEEKS = [
  '2026-05-04', '2026-05-05', '2026-05-06', '2026-05-07', '2026-05-08',
  '2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15',
];

// ---------------------------------------------------------------------------
// 1. Present/absent/sick/late/excused totals + percentage
{
  const learner = { id: 'l1' };
  const statuses = ['present', 'present', 'present', 'absent', 'sick', 'late', 'excused', 'present', 'present', 'present'];
  const days = TWO_WEEKS.map((date, i) => day(date, { l1: rec(statuses[i]) }));
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(totals.eligibleDays, 10);
  assert.equal(totals.presentDays, 6);
  assert.equal(totals.absentDays, 1);
  assert.equal(totals.sickDays, 1);
  assert.equal(totals.lateDays, 1);
  assert.equal(totals.excusedDays, 1);
  assert.equal(totals.unmarkedDays, 0);
  // 2. Late counts as present: (6 + 1) / 10
  assert.equal(totals.attendedDays, 7);
  assert.equal(totals.attendancePercentage, 70);
  assert.equal(formatPercent(totals.attendancePercentage), '70.0%');
}

// ---------------------------------------------------------------------------
// 3. Learner joining mid-term is not absent before joining
{
  const learner = { id: 'l2', joinedClassOn: '2026-05-11' };
  const days = TWO_WEEKS.map((date) => day(date, { l2: date >= '2026-05-11' ? rec('present') : undefined }));
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(totals.eligibleDays, 5);
  assert.equal(totals.presentDays, 5);
  assert.equal(totals.absentDays, 0);
  assert.equal(totals.unmarkedDays, 0);
  assert.equal(totals.attendancePercentage, 100);
  const window = learnerEligibilityWindow(learner, TERM);
  assert.deepEqual(window, { start: '2026-05-11', end: '2026-05-29' });
  assert.equal(isLearnerEligibleOn(learner, '2026-05-05', TERM), false);
  assert.equal(isLearnerEligibleOn(learner, '2026-05-12', TERM), true);
}

// ---------------------------------------------------------------------------
// 4. Learner withdrawing mid-term keeps history, stops accruing days
{
  const learner = { id: 'l3', leftClassOn: '2026-05-08', enrolmentStatus: 'withdrawn' };
  const days = TWO_WEEKS.map((date) => day(date, { l3: date <= '2026-05-08' ? rec(date === '2026-05-06' ? 'absent' : 'present') : undefined }));
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(totals.eligibleDays, 5);
  assert.equal(totals.presentDays, 4);
  assert.equal(totals.absentDays, 1);
  assert.equal(totals.attendancePercentage, 80);
}

// Learner who joined after leaving / outside the term has no window
{
  assert.equal(learnerEligibilityWindow({ id: 'x', joinedClassOn: '2026-06-10' }, TERM), null);
  const totals = computeLearnerTotals({ learner: { id: 'x', joinedClassOn: '2026-06-10' }, days: [], term: TERM });
  assert.equal(totals.eligibleDays, 0);
  assert.equal(totals.attendancePercentage, null); // no division by zero
  assert.equal(formatPercent(totals.attendancePercentage), '—');
}

// ---------------------------------------------------------------------------
// 16. Legacy learner without enrolment dates gets the whole term
{
  const window = learnerEligibilityWindow({ id: 'legacy' }, TERM);
  assert.deepEqual(window, { start: TERM.startDate, end: TERM.endDate });
}

// ---------------------------------------------------------------------------
// not_applicable removes the day from eligible totals
{
  const learner = { id: 'l4' };
  const days = TWO_WEEKS.slice(0, 5).map((date, i) => day(date, { l4: rec(i === 2 ? 'not_applicable' : 'present') }));
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(totals.eligibleDays, 4);
  assert.equal(totals.notApplicableDays, 1);
  assert.equal(totals.attendancePercentage, 100);
}

// Unmarked eligible days count in the denominator by default…
{
  const learner = { id: 'l5' };
  const days = TWO_WEEKS.slice(0, 5).map((date, i) => day(date, i < 4 ? { l5: rec('present') } : {}));
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(totals.eligibleDays, 5);
  assert.equal(totals.unmarkedDays, 1);
  assert.equal(totals.attendancePercentage, 80);
  // …but the policy object can exclude them.
  const lenient = computeLearnerTotals({ learner, days, term: TERM, policy: { unmarkedCountsInDenominator: false } });
  assert.equal(lenient.eligibleDays, 4);
  assert.equal(lenient.attendancePercentage, 100);
}

// Policy: excused can be configured to count as attended
{
  const learner = { id: 'l6' };
  const days = TWO_WEEKS.slice(0, 4).map((date, i) => day(date, { l6: rec(i === 0 ? 'excused' : 'present') }));
  const strict = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(strict.attendancePercentage, 75);
  const lenient = computeLearnerTotals({ learner, days, term: TERM, policy: { excusedCountsAsAttended: true } });
  assert.equal(lenient.attendancePercentage, 100);
}

// Policy: half-day weighting
{
  const learner = { id: 'l7' };
  const days = [
    day('2026-05-04', { l7: rec('present') }),
    { date: '2026-05-05', classification: 'half_day', records: { l7: rec('absent') } },
  ];
  const weighted = computeLearnerTotals({ learner, days, term: TERM, policy: { halfDayWeight: 0.5 } });
  assert.equal(weighted.eligibleDays, 1.5);
  assert.equal(weighted.attendedDays, 1);
  assert.equal(Math.round(weighted.attendancePercentage * 10) / 10, 66.7);
}

// Optional-attendance days only count when marked
{
  const learner = { id: 'l8' };
  const days = [
    day('2026-05-04', { l8: rec('present') }),
    { date: '2026-05-05', classification: 'optional_attendance_day', records: {} },
    { date: '2026-05-06', classification: 'optional_attendance_day', records: { l8: rec('present') } },
  ];
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.equal(totals.eligibleDays, 2);
  assert.equal(totals.unmarkedDays, 0);
  assert.equal(totals.attendancePercentage, 100);
}

// Percentage rounding is display-only (underlying value stays exact)
{
  const learner = { id: 'l9' };
  const days = TWO_WEEKS.slice(0, 9).map((date, i) => day(date, { l9: rec(i < 8 ? 'present' : 'absent') }));
  const totals = computeLearnerTotals({ learner, days, term: TERM });
  assert.ok(Math.abs(totals.attendancePercentage - 88.8888888888) < 1e-6);
  assert.equal(formatPercent(totals.attendancePercentage), '88.9%');
}

// ---------------------------------------------------------------------------
// computeDailyCounts ignores junk statuses
{
  const counts = computeDailyCounts({
    a: rec('present'), b: rec('present'), c: rec('late'), d: rec('sick'),
    e: { status: 'bogus' }, f: {},
  });
  assert.equal(counts.present, 2);
  assert.equal(counts.late, 1);
  assert.equal(counts.sick, 1);
  assert.equal(counts.marked, 4);
}

// ---------------------------------------------------------------------------
// Class summary: enrolment, gender, today, aggregate + trend + threshold lists
{
  const learners = [
    { id: 'a', gender: 'M' },
    { id: 'b', gender: 'F' },
    { id: 'c', gender: 'F', joinedClassOn: '2026-05-11' },
    { id: 'gone', gender: 'M', leftClassOn: '2026-05-08', enrolmentStatus: 'withdrawn' },
  ];
  const days = TWO_WEEKS.map((date) => day(date, {
    a: rec('present'),
    b: rec(date === '2026-05-14' ? 'absent' : date === '2026-05-15' ? 'sick' : 'present'),
    ...(date >= '2026-05-11' ? { c: rec('present') } : {}),
    ...(date <= '2026-05-08' ? { gone: rec('present') } : {}),
  }));
  const summary = computeClassSummary({ learners, days, term: TERM, todayIso: '2026-05-15' });
  assert.equal(summary.enrolment, 3); // withdrawn learner not in active enrolment
  assert.equal(summary.boys, 1);
  assert.equal(summary.girls, 2);
  assert.equal(summary.todayCounts.eligible, 3);
  assert.equal(summary.todayCounts.present, 2);
  assert.equal(summary.todayCounts.sick, 1);
  assert.equal(summary.todayCounts.unmarked, 0);
  // possible = a:10 + b:10 + c:5 + gone:5 = 30; actual = 10 + 8 + 5 + 5 = 28
  assert.equal(summary.possibleAttendance, 30);
  assert.equal(summary.actualAttendance, 28);
  assert.ok(Math.abs(summary.averageAttendancePercentage - (28 / 30) * 100) < 1e-9);
  assert.deepEqual(summary.perfectAttendance.sort(), ['a', 'c', 'gone']);
  assert.equal(summary.belowThreshold.length, 0);
  assert.equal(summary.monthlyTrend.length, 1);
  assert.equal(summary.monthlyTrend[0].month, '2026-05');
  assert.ok(Math.abs(summary.monthlyTrend[0].percentage - (28 / 30) * 100) < 1e-9);
  // withdrawn learner's history is retained in per-learner totals
  const gone = summary.perLearner.find((p) => p.learner.id === 'gone');
  assert.equal(gone.totals.presentDays, 5);
}

// Below-threshold list respects the configurable threshold
{
  const learners = [{ id: 'a' }];
  const days = TWO_WEEKS.map((date, i) => day(date, { a: rec(i < 8 ? 'present' : 'absent') })); // 80%
  const strict = computeClassSummary({ learners, days, term: TERM, policy: { warningThresholdPercent: 90 }, todayIso: null });
  assert.equal(strict.belowThreshold.length, 1);
  const lax = computeClassSummary({ learners, days, term: TERM, policy: { warningThresholdPercent: 80 }, todayIso: null });
  assert.equal(lax.belowThreshold.length, 0); // 80 is not below 80
}

// Empty roster / no days never divides by zero
{
  const summary = computeClassSummary({ learners: [], days: [], term: TERM, todayIso: '2026-05-15' });
  assert.equal(summary.enrolment, 0);
  assert.equal(summary.averageAttendancePercentage, null);
  assert.equal(summary.possibleAttendance, 0);
}

// ---------------------------------------------------------------------------
// Status configuration sanity: symbols + validation
{
  assert.deepEqual(ATTENDANCE_STATUS_ORDER.map((s) => ATTENDANCE_STATUSES[s].symbol), ['P', 'A', 'S', 'L', 'E', '–']);
  assert.ok(isValidStatus('present'));
  assert.ok(!isValidStatus('holiday'));
  const policy = resolveAttendancePolicy();
  assert.ok(policy.attendedSet.has('late'));
  assert.ok(!policy.attendedSet.has('excused'));
}

console.log('test-attendance-calculator: all assertions passed');
