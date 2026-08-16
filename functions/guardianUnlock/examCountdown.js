"use strict";

/**
 * examCountdown — the server's copy of the ECZ Grade 7 exam start.
 *
 * A MIRROR, and mirrors in this repo carry a test: `test:exam-date-mirror`
 * fails if this value drifts from `PSLE_2026.startsAt` in
 * `src/config/examTimetable2026.js`, which is the timetable transcribed from
 * the official ECZ PDF and therefore the document a person checks against.
 *
 * Why a mirror rather than an import: the client's `src/config/examDates.js`
 * reads the date out of the full timetable module, which carries every paper,
 * every session and every start time for the week. Pulling that into a Cloud
 * Function to learn one date would add a client-shaped config file to the
 * server's cold-start cost for no benefit — the same reasoning
 * `functions/plans.js` and `functions/attendance/moeTermData.js` already
 * follow, and it is why both of those are guarded the same way.
 *
 * The rule the callers depend on is identical to the client's: a positive
 * integer or null. Never NaN, never negative, never zero for an exam that has
 * already started — a guardian message must not say "exams in -3 days".
 */

/** Must equal PSLE_2026.startsAt. Guarded by test:exam-date-mirror. */
const GRADE7_ECZ_EXAM_START = "2026-10-26T08:00:00+02:00";

const EXAM_START_DATES = Object.freeze({
  7: GRADE7_ECZ_EXAM_START,
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function examStartForGrade(grade) {
  if (grade == null) return null;
  const digits = String(grade).match(/\d+/);
  if (!digits) return null;
  const raw = EXAM_START_DATES[Number(digits[0])];
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @returns {number|null} whole days until the exam, or null. */
function daysToExam(grade, now = new Date()) {
  const start = examStartForGrade(grade);
  if (!start) return null;
  const at = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.ceil((start.getTime() - at.getTime()) / MS_PER_DAY);
  return days > 0 ? days : null;
}

module.exports = {GRADE7_ECZ_EXAM_START, EXAM_START_DATES, examStartForGrade, daysToExam};
