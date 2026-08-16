/**
 * Node test for the platform-metrics pure helpers.
 * Run: node functions/platformMetricsCore.test.js
 */

const assert = require("node:assert");
const {
  ACTIVITY_SOURCES,
  RETENTION_WINDOWS,
  dayKeyFor,
  dayWindow,
  shiftDayKey,
  retentionRate,
  retentionRecord,
  chunk,
  buildDayStats,
} = require("./platformMetricsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("platformMetricsCore");

// ── dayKeyFor / dayWindow: Lusaka (UTC+2) bucketing ─────────────────────────
ok("midday UTC → same date",
    dayKeyFor(new Date("2026-06-23T12:00:00Z")) === "2026-06-23");
// 23:00Z is 01:00 the NEXT day in Lusaka. Bucketing on UTC would file a
// learner's late-evening session under the wrong school day.
ok("23:00 UTC rolls into the next Lusaka day",
    dayKeyFor(new Date("2026-06-23T23:00:00Z")) === "2026-06-24");
ok("21:59 UTC is still the same Lusaka day",
    dayKeyFor(new Date("2026-06-23T21:59:59Z")) === "2026-06-23");

const w = dayWindow("2026-06-23");
ok("window starts at 22:00Z the previous day",
    w.start.toISOString() === "2026-06-22T22:00:00.000Z");
ok("window ends at 22:00Z the same day",
    w.end.toISOString() === "2026-06-23T22:00:00.000Z");
ok("window is exactly 24h",
    w.end.getTime() - w.start.getTime() === 24 * 3600 * 1000);
// Half-open: the instant that ends day N is the instant that starts day N+1,
// and belongs to exactly one of them.
ok("windows tile without overlap",
    dayWindow("2026-06-24").start.getTime() === w.end.getTime());
ok("a timestamp at the boundary belongs to the later day",
    dayKeyFor(w.end) === "2026-06-24");
assert.throws(() => dayWindow("23/06/2026"), TypeError);
ok("a non-ISO day key throws rather than silently producing NaN", true);

// ── shiftDayKey: must survive month/year/leap boundaries ────────────────────
ok("shift back one day", shiftDayKey("2026-06-23", -1) === "2026-06-22");
ok("shift back seven days", shiftDayKey("2026-06-23", -7) === "2026-06-16");
ok("shift across a month boundary", shiftDayKey("2026-07-01", -1) === "2026-06-30");
ok("shift across a year boundary", shiftDayKey("2026-01-01", -1) === "2025-12-31");
ok("shift back 30 days across a month", shiftDayKey("2026-03-05", -30) === "2026-02-03");
ok("leap day is reachable", shiftDayKey("2028-03-01", -1) === "2028-02-29");
ok("shift is reversible", shiftDayKey(shiftDayKey("2026-08-16", -30), 30) === "2026-08-16");

// ── retentionRate: the 0/0 trap ─────────────────────────────────────────────
ok("half the cohort returned", retentionRate(5, 10) === 0.5);
ok("rate is rounded to 4dp", retentionRate(1, 3) === 0.3333);
ok("a full cohort returning is 1", retentionRate(7, 7) === 1);
// The important one: a day with no signups must NOT read as 0% retention.
ok("an empty cohort is null, not zero", retentionRate(0, 0) === null);
ok("a negative cohort is null", retentionRate(0, -4) === null);
ok("nobody returning from a real cohort IS zero", retentionRate(0, 12) === 0);

const rec = retentionRecord(7, "2026-06-16", 20, 6);
ok("retentionRecord carries the cohort day it measured", rec.cohortDay === "2026-06-16");
ok("retentionRecord computes its own rate", rec.rate === 0.3);
ok("retentionRecord names its window", rec.window === 7);

// ── chunk: dropping a user here inflates retention ──────────────────────────
ok("chunk splits evenly", JSON.stringify(chunk([1, 2, 3, 4], 2)) === "[[1,2],[3,4]]");
ok("chunk keeps the short tail", JSON.stringify(chunk([1, 2, 3], 2)) === "[[1,2],[3]]");
ok("chunk of an empty list is empty", chunk([], 10).length === 0);
ok("chunk never loses an element",
    chunk(Array.from({length: 97}, (_, i) => i), 10).flat().length === 97);
ok("chunk with a bogus size still terminates", chunk([1, 2, 3], 0).flat().length === 3);
ok("chunk of a non-array is empty", chunk(null, 5).length === 0);

// ── buildDayStats ───────────────────────────────────────────────────────────
const stats = buildDayStats({
  dayKey: "2026-06-23",
  activeByUid: new Map([["u1", "learner"], ["u2", "learner"], ["u3", "teacher"], ["u4", ""]]),
  counts: {quizCompletions: 12, gameRounds: 30, examAttempts: 4},
  newUsers: 3,
  retention: [
    retentionRecord(1, "2026-06-22", 10, 4),
    retentionRecord(7, "2026-06-16", 0, 0),
  ],
});
ok("dau counts DISTINCT uids, not events", stats.dau === 4);
ok("activity events sum every source", stats.activityEvents === 46);
ok("roles are broken out", stats.activeByRole.learner === 2 && stats.activeByRole.teacher === 1);
// A uid whose user doc is missing (deleted mid-day, or a legacy account) must
// still count toward DAU — it is a real session — but must not be filed as a
// role it never had.
ok("an unknown role is bucketed, not dropped", stats.activeByRole.unknown === 1);
ok("retention is keyed for direct lookup", stats.retention.d1.rate === 0.4);
ok("an empty cohort surfaces as null rate", stats.retention.d7.rate === null);
ok("newUsers is carried through", stats.newUsers === 3);
ok("the day key is on the doc", stats.day === "2026-06-23");

const empty = buildDayStats({
  dayKey: "2026-06-24",
  activeByUid: new Map(),
  counts: {},
  newUsers: 0,
  retention: [],
});
ok("a dead day is all zeroes, not undefined",
    empty.dau === 0 && empty.activityEvents === 0 && empty.quizCompletions === 0);

// ── config sanity ───────────────────────────────────────────────────────────
ok("every activity source names a uid field and a time field",
    ACTIVITY_SOURCES.every((s) => s.collection && s.uidField && s.timeField && s.countAs));
ok("activity source countAs keys are unique",
    new Set(ACTIVITY_SOURCES.map((s) => s.countAs)).size === ACTIVITY_SOURCES.length);
ok("retention windows are ascending and positive",
    RETENTION_WINDOWS.every((d, i) => d > 0 && (i === 0 || d > RETENTION_WINDOWS[i - 1])));

console.log(`\n─── platformMetricsCore · ${passed} passed ───`);
