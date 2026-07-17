// Plain-node tests for the attendance calendar resolver.
// Run: npm run test:attendance-calendar  (auto-discovered by run-all-tests.mjs)
import assert from 'node:assert/strict';
import {
  CALENDAR_DATASETS,
  officialDatasetFor,
  calendarMetaForTerm,
  weekdayOf,
  addDaysIso,
  mondayOf,
  isValidIsoDate,
  termNumberFromLabel,
  isCalendarCoveredYear,
  resolveTermInfo,
  customTermInfo,
  buildTermDays,
  registerDays,
  markableDays,
  groupDaysByWeek,
  groupDaysByMonth,
  weekStripFor,
  nearestMarkableDate,
  defaultRegisterDate,
} from '../src/utils/attendanceCalendarResolver.js';

// ── primitives ──────────────────────────────────────────────────────────────
assert.equal(weekdayOf('2026-05-11'), 1); // Monday
assert.equal(weekdayOf('2026-05-16'), 6); // Saturday
assert.equal(addDaysIso('2026-05-31', 1), '2026-06-01');
assert.equal(mondayOf('2026-05-14'), '2026-05-11'); // Thursday → Monday
assert.equal(mondayOf('2026-05-17'), '2026-05-11'); // Sunday → previous Monday
assert.ok(isValidIsoDate('2026-05-11'));
assert.ok(!isValidIsoDate('2026-02-30'));
assert.ok(!isValidIsoDate('11/05/2026'));
assert.equal(termNumberFromLabel('Term 2'), 2);
assert.equal(termNumberFromLabel('term two'), null);

// ── term resolution from the MoE calendar ───────────────────────────────────
const info = resolveTermInfo({ term: 'Term 2', year: 2026 });
assert.equal(info.termId, '2026-T2');
assert.equal(info.startDate, '2026-05-11');
assert.equal(info.endDate, '2026-08-07');
// Only in-term holidays are kept (the MoE list includes pre-opening dates).
assert.ok(info.holidays.every((h) => h.date >= info.startDate && h.date <= info.endDate));
assert.ok(info.holidays.some((h) => h.date === '2026-05-25')); // Africa Freedom Day
assert.ok(info.eceMidBreak);

// Unconfigured years/terms return null (studio shows the empty state)
assert.equal(resolveTermInfo({ term: 'Term 1', year: 2024 }), null);
assert.equal(resolveTermInfo({ term: 'Weird Term', year: 2026 }), null);
assert.ok(isCalendarCoveredYear(2026));
assert.ok(!isCalendarCoveredYear(2024));

// Custom term dates fill the gap for uncovered years
const custom = customTermInfo({ term: 'Term 1', year: 2024, startDate: '2024-01-08', endDate: '2024-03-28' });
assert.equal(custom.source, 'custom');
assert.equal(custom.termId, '2024-T1');
assert.equal(customTermInfo({ term: 'Term 1', year: 2024, startDate: '2024-03-28', endDate: '2024-01-08' }), null);

// ── day building: weekends + holidays excluded, future not markable ─────────
const TODAY = '2026-06-15';
const days = buildTermDays({ termInfo: info, todayIso: TODAY });

// 5. Weekends and holidays are never register days
const byDate = new Map(days.map((d) => [d.date, d]));
assert.equal(byDate.get('2026-05-16').classification, 'non_teaching_day'); // Saturday
assert.equal(byDate.get('2026-05-17').classification, 'non_teaching_day'); // Sunday
assert.equal(byDate.get('2026-05-25').classification, 'non_teaching_day'); // public holiday
assert.equal(byDate.get('2026-05-25').holidayName, 'Africa Freedom Day');
assert.equal(byDate.get('2026-05-12').classification, 'teaching_day');
const reg = registerDays(days);
assert.ok(reg.every((d) => ![0, 6].includes(d.weekday)));
assert.ok(!reg.some((d) => d.date === '2026-05-25'));

// 6. Future dates are excluded from markable dates
const markable = markableDays(days);
assert.ok(markable.every((d) => d.date <= TODAY));
assert.ok(byDate.get('2026-06-16').isFuture);
assert.ok(!byDate.get('2026-06-16').markable);
assert.ok(byDate.get('2026-06-15').isToday);
assert.ok(byDate.get('2026-06-15').markable);

// Overrides win: close a Tuesday, open a Saturday, make a Friday optional
const withOverrides = buildTermDays({
  termInfo: info,
  todayIso: TODAY,
  dayOverrides: {
    '2026-05-12': 'school_closure',
    '2026-05-16': 'teaching_day',
    '2026-05-15': 'optional_attendance_day',
    '2026-05-13': 'not_a_real_classification', // ignored
  },
})
const ovr = new Map(withOverrides.map((d) => [d.date, d]));
assert.equal(ovr.get('2026-05-12').classification, 'school_closure');
assert.ok(!ovr.get('2026-05-12').markable);
assert.equal(ovr.get('2026-05-16').classification, 'teaching_day');
assert.ok(ovr.get('2026-05-16').markable);
assert.equal(ovr.get('2026-05-15').classification, 'optional_attendance_day');
assert.equal(ovr.get('2026-05-13').classification, 'teaching_day'); // junk override ignored

// Closures (e.g. ECE mid-term break) block out whole ranges
const withBreak = buildTermDays({ termInfo: info, todayIso: TODAY, closures: [info.eceMidBreak] });
const brk = new Map(withBreak.map((d) => [d.date, d]));
assert.equal(brk.get('2026-06-23').classification, 'school_closure');
assert.ok(!brk.get('2026-06-23').markable);

// ── grouping ────────────────────────────────────────────────────────────────
const weeks = groupDaysByWeek(days, info.startDate);
assert.equal(weeks[0].weekNumber, 1);
assert.equal(weeks[0].days[0].date, '2026-05-11');
assert.equal(weeks[0].days.length, 5);
assert.equal(weeks[2].days.length, 4); // week of 25 May loses the holiday Monday
assert.ok(weeks.every((w, i) => i === 0 || w.weekNumber > weeks[i - 1].weekNumber));

const months = groupDaysByMonth(days);
assert.deepEqual(months.map((m) => m.key), ['2026-05', '2026-06', '2026-07', '2026-08']);
assert.equal(months[0].label, 'May 2026');
assert.ok(months.every((m) => m.days.every((d) => d.date.startsWith(m.key))));

// ── navigation helpers ──────────────────────────────────────────────────────
const strip = weekStripFor('2026-05-14', days);
assert.deepEqual(strip.map((d) => d.date), ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14', '2026-05-15']);

// prev/next skip weekends + holidays: Friday 22 May → next markable is Tue 26
assert.equal(nearestMarkableDate(days, '2026-05-22', +1), '2026-05-26');
assert.equal(nearestMarkableDate(days, '2026-05-26', -1), '2026-05-22');
assert.equal(nearestMarkableDate(days, TODAY, +1), null); // future is never markable

// default date: today when markable, else most recent markable day
assert.equal(defaultRegisterDate(days, TODAY), TODAY);
assert.equal(defaultRegisterDate(days, '2026-06-14'), '2026-06-12'); // Sunday → Friday
assert.equal(defaultRegisterDate([], TODAY), null);

// ── versioned calendar datasets + post-2030 fallback ────────────────────────
{
  // Official presets are a versioned dataset registry — future MoE releases
  // slot in as new entries without touching attendance components.
  assert.ok(CALENDAR_DATASETS.length >= 1);
  assert.equal(officialDatasetFor(2026)?.id, 'moe-zambia-2026-2030');
  assert.equal(officialDatasetFor(2030)?.id, 'moe-zambia-2026-2030');
  // No official preset after 2030: resolution is exact-year only — dates are
  // NEVER silently reused from a previous year.
  assert.equal(officialDatasetFor(2031), null);
  assert.equal(resolveTermInfo({ term: 'Term 1', year: 2031 }), null);

  // Source metadata: official preset vs school-customised vs unconfigured.
  const official = calendarMetaForTerm(resolveTermInfo({ term: 'Term 2', year: 2026 }));
  assert.equal(official.source, 'official');
  assert.equal(official.datasetId, 'moe-zambia-2026-2030');
  assert.equal(official.version, 1);
  assert.ok(official.label.includes('Official preset'));
  const customMeta = calendarMetaForTerm(customTermInfo({ term: 'Term 1', year: 2031, startDate: '2031-01-13', endDate: '2031-04-11' }));
  assert.equal(customMeta.source, 'custom');
  assert.equal(customMeta.datasetId, null);
  const none = calendarMetaForTerm(null);
  assert.equal(none.source, 'none');

  // resolveTermInfo now carries dataset provenance.
  const t = resolveTermInfo({ term: 'Term 2', year: 2026 });
  assert.equal(t.calendarDatasetId, 'moe-zambia-2026-2030');
  assert.equal(t.calendarVersion, 1);

  // Custom post-2030 terms still build a full day list.
  const custom31 = customTermInfo({ term: 'Term 1', year: 2031, startDate: '2031-01-13', endDate: '2031-04-11' });
  const days31 = buildTermDays({ termInfo: custom31, todayIso: '2031-02-10' });
  assert.ok(registerDays(days31).length > 40);
}

console.log('test-attendance-calendar: all assertions passed');
