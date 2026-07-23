/* Plain-node tests for classPerformanceCore (npm run test:class-performance). */
const assert = require("node:assert/strict");
const {
  weeklyWindows,
  toResultRow,
  bucketWeeklyAverages,
  buildPerformanceSeries,
  hasChartableData,
  WEEK_MS,
} = require("./classPerformanceCore");

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

// ── windows ──────────────────────────────────────────────────────────
const windows = weeklyWindows(NOW, 3);
assert.equal(windows.length, 3);
assert.equal(windows[2].endMs, NOW);
assert.equal(windows[2].startMs, NOW - WEEK_MS);
assert.equal(windows[0].endMs, NOW - 2 * WEEK_MS);
// contiguous, oldest first
assert.equal(windows[0].endMs, windows[1].startMs);

// ── row normalization ────────────────────────────────────────────────
assert.deepEqual(
    toResultRow({userId: "u1", completedAtMs: 123, percentage: 80}),
    {userId: "u1", completedAtMs: 123, percentage: 80, provisional: false},
);
// Firestore Timestamp shape
assert.equal(toResultRow({completedAt: {toMillis: () => 456}}).completedAtMs, 456);
// Provisional flags (either field) survive normalization
assert.equal(toResultRow({gradingStatus: "pending", completedAtMs: 1}).provisional, true);
assert.equal(toResultRow({scoreStatus: "provisional", completedAtMs: 1}).provisional, true);
// Garbage percentage → null
assert.equal(toResultRow({percentage: "90", completedAtMs: 1}).percentage, null);

// ── weekly averages ──────────────────────────────────────────────────
const rows = [
  // this week: 80 and 60 → 70
  {userId: "a", completedAtMs: NOW - 1 * DAY, percentage: 80, provisional: false},
  {userId: "b", completedAtMs: NOW - 2 * DAY, percentage: 60, provisional: false},
  // this week but provisional — counts as attempt, not in average
  {userId: "c", completedAtMs: NOW - 3 * DAY, percentage: 100, provisional: true},
  // last week: single 50
  {userId: "a", completedAtMs: NOW - 9 * DAY, percentage: 50, provisional: false},
  // outside the 3-week window entirely
  {userId: "a", completedAtMs: NOW - 40 * DAY, percentage: 10, provisional: false},
];
const buckets = bucketWeeklyAverages(rows, {now: NOW, weeks: 3});
assert.equal(buckets.length, 3);
assert.equal(buckets[2].average, 70);
assert.equal(buckets[2].attempts, 3);
assert.equal(buckets[1].average, 50);
// Empty week is a null gap, never a fabricated zero
assert.equal(buckets[0].average, null);
assert.equal(buckets[0].attempts, 0);

// ── merged series ────────────────────────────────────────────────────
const series = buildPerformanceSeries({
  classRows: rows,
  platformWeekly: [55.4, null, 62.6],
  now: NOW,
  weeks: 3,
});
assert.equal(series.length, 3);
assert.deepEqual(
    series.map((p) => [p.yourClass, p.classAverage]),
    [[null, 55], [50, null], [70, 63]],
);
assert.equal(series[2].attempts, 3);

// ── chartability gate ────────────────────────────────────────────────
assert.equal(hasChartableData(series), true);
assert.equal(hasChartableData([{yourClass: 70}, {yourClass: null}]), false);
assert.equal(hasChartableData([]), false);

console.log("classPerformanceCore: all assertions passed");
