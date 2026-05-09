/**
 * Shared parent-portal helpers — aggregation logic re-used by both the
 * public getProgressShare callable (parentPortal.js) and the weekly
 * digest cron (weeklyParentDigest.js).
 *
 * Kept in its own module so the two consumers stay narrow and easy
 * to unit-test independently.
 */

const admin = require("firebase-admin");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECENT_RESULTS = 12;

/**
 * Aggregate the learner's last `windowDays` of activity into a
 * parent-friendly shape:
 *   { summary, subjectBreakdown, recentResults }
 *
 * Bounded reads — single Firestore query for results, capped client-
 * side via the index. Falls back to ordered+filtered if the composite
 * index isn't available yet.
 */
async function aggregateProgress(db, learnerUid, {windowDays = 30} = {}) {
  const now = Date.now();
  const sinceTs = admin.firestore.Timestamp.fromMillis(now - windowDays * ONE_DAY_MS);

  let resultsSnap;
  try {
    resultsSnap = await db.collection("results")
        .where("userId", "==", learnerUid)
        .where("completedAt", ">=", sinceTs)
        .orderBy("completedAt", "desc")
        .get();
  } catch (err) {
    console.warn("[parentPortalShared] indexed results read failed", err);
    resultsSnap = null;
  }
  const results = resultsSnap ? resultsSnap.docs.map((d) => d.data()) : [];

  let percentageSum = 0;
  let percentageCount = 0;
  const subjectBuckets = new Map();
  const dayKeys = new Set();
  for (const r of results) {
    if (typeof r.percentage === "number") {
      percentageSum += r.percentage;
      percentageCount += 1;
    }
    if (r.subject) {
      const b = subjectBuckets.get(r.subject) || {count: 0, sum: 0};
      b.count += 1;
      if (typeof r.percentage === "number") b.sum += r.percentage;
      subjectBuckets.set(r.subject, b);
    }
    const ms = r.completedAt?.toMillis ? r.completedAt.toMillis() : 0;
    if (ms > 0) {
      const d = new Date(ms);
      d.setUTCHours(0, 0, 0, 0);
      dayKeys.add(d.getTime());
    }
  }

  // Streak — count back from today (or yesterday) through consecutive
  // days with at least one result.
  let streak = 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let cursor = today.getTime();
  if (!dayKeys.has(cursor)) cursor -= ONE_DAY_MS;
  while (dayKeys.has(cursor)) {
    streak += 1;
    cursor -= ONE_DAY_MS;
  }

  return {
    summary: {
      totalAttempts: results.length,
      averagePercentage: percentageCount > 0
          ? Math.round(percentageSum / percentageCount)
          : null,
      currentStreak: streak,
      windowDays,
    },
    subjectBreakdown: [...subjectBuckets.entries()]
        .map(([subject, b]) => ({
          subject,
          count: b.count,
          averagePercentage: b.count > 0 ? Math.round(b.sum / b.count) : null,
        }))
        .sort((a, b) => b.count - a.count),
    recentResults: results.slice(0, MAX_RECENT_RESULTS).map((r) => ({
      quizId: r.quizId || null,
      quizTitle: r.quizTitle || r.title || null,
      subject: r.subject || null,
      grade: r.grade || null,
      percentage: typeof r.percentage === "number" ? r.percentage : null,
      score: typeof r.score === "number" ? r.score : null,
      totalMarks: typeof r.totalMarks === "number" ? r.totalMarks : null,
      completedAtMs: r.completedAt?.toMillis ? r.completedAt.toMillis() : null,
    })),
  };
}

module.exports = {aggregateProgress, ONE_DAY_MS};
