// Mirror guard: functions/attendance/moeTermData.js must stay an exact
// projection of src/utils/moeCalendar.js (the source of truth). A drift here
// would let the client and the server disagree about term windows/holidays.
// Run: npm run test:attendance-term-mirror  (auto-discovered by run-all-tests.mjs)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MOE_CALENDAR } from '../src/utils/moeCalendar.js';

const require = createRequire(import.meta.url);
const { MOE_TERM_DATA } = require('../functions/attendance/moeTermData.js');

const expected = {};
for (const [year, y] of Object.entries(MOE_CALENDAR)) {
  expected[year] = y.terms.map((t) => ({
    id: t.id,
    number: t.number,
    open: t.open,
    close: t.close,
    eceMidStart: t.eceMidStart ?? null,
    eceMidEnd: t.eceMidEnd ?? null,
    holidays: t.holidays.map((h) => ({ name: h.name, date: h.date })),
  }));
}

assert.deepEqual(
  MOE_TERM_DATA,
  expected,
  'functions/attendance/moeTermData.js has drifted from src/utils/moeCalendar.js — regenerate the projection',
);

console.log('test-attendance-term-mirror: server term data matches src/utils/moeCalendar.js');
