/**
 * Pure logic for the class performance time series (dashboard's
 * Performance Snapshot). No firebase deps — tested under plain `node`
 * by classPerformanceCore.test.js (npm run test:class-performance).
 *
 * A "result row" is { userId, completedAtMs, percentage, provisional } —
 * the callable normalizes Firestore docs into this shape first.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The [start, end) millisecond windows for the last `weeks` 7-day buckets,
 * oldest first, with the newest bucket ending at `now`.
 */
function weeklyWindows(now, weeks) {
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = now - i * WEEK_MS;
    out.push({startMs: end - WEEK_MS, endMs: end});
  }
  return out;
}

/**
 * Normalize a Firestore result doc into the pure row shape. Provisional
 * results (text answers still awaiting AI marking) are kept as attempts
 * but flagged so they never feed an average — same rule as getClassStats.
 */
function toResultRow(doc) {
  const completedAtMs = doc.completedAt?.toMillis ?
    doc.completedAt.toMillis() :
    (Number.isFinite(doc.completedAtMs) ? doc.completedAtMs : 0);
  return {
    userId: doc.userId || null,
    completedAtMs,
    percentage: (typeof doc.percentage === "number" && Number.isFinite(doc.percentage)) ?
      doc.percentage :
      null,
    provisional: doc.gradingStatus === "pending" || doc.scoreStatus === "provisional",
  };
}

/**
 * Bucket result rows into weekly average percentages.
 *
 * Returns one entry per window, oldest first:
 *   { startMs, endMs, average: number|null, attempts }
 * `average` is null (never 0) for a week with no final scored attempts —
 * the chart must show a gap, not a fabricated zero.
 */
function bucketWeeklyAverages(rows, {now, weeks = 6} = {}) {
  const windows = weeklyWindows(now, weeks);
  return windows.map(({startMs, endMs}) => {
    let sum = 0;
    let count = 0;
    let attempts = 0;
    for (const r of rows) {
      if (r.completedAtMs <= startMs || r.completedAtMs > endMs) continue;
      attempts += 1;
      if (r.provisional || r.percentage == null) continue;
      sum += r.percentage;
      count += 1;
    }
    return {
      startMs,
      endMs,
      average: count > 0 ? Math.round(sum / count) : null,
      attempts,
    };
  });
}

/**
 * Merge the teacher's weekly averages with the platform baseline into the
 * final series the dashboard chart consumes. `platformWeekly` is an array
 * of number|null aligned to the same windows (oldest first).
 */
function buildPerformanceSeries({classRows = [], platformWeekly = [], now, weeks = 6}) {
  const buckets = bucketWeeklyAverages(classRows, {now, weeks});
  return buckets.map((b, i) => ({
    startMs: b.startMs,
    endMs: b.endMs,
    yourClass: b.average,
    classAverage: Number.isFinite(platformWeekly[i]) ? Math.round(platformWeekly[i]) : null,
    attempts: b.attempts,
  }));
}

/** True when the series has enough real data to chart (≥2 scored weeks). */
function hasChartableData(series) {
  return series.filter((p) => p.yourClass != null).length >= 2;
}

module.exports = {
  WEEK_MS,
  weeklyWindows,
  toResultRow,
  bucketWeeklyAverages,
  buildPerformanceSeries,
  hasChartableData,
};
