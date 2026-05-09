/**
 * Public marketing stats aggregator (audit C4).
 *
 * The marketing page used to claim "Built in Zambia, CBC-aligned, etc."
 * with no quantitative backing. This cron writes a single doc the
 * marketing surface reads anonymously to render real numbers:
 *
 *   publicStats/global: {
 *     learners:                <number>  // total learner accounts
 *     gamesPlayedThisWeek:     <number>  // scores.playedAt >= 7d ago
 *     quizzesTakenAllTime:     <number>  // results.* total
 *     quizzesAvailable:        <number>  // quizzes where status==published
 *     updatedAt:               serverTimestamp
 *   }
 *
 * Why a cron instead of read-on-render:
 *   - Cheapest path to anonymous visitors. One getDoc on the marketing
 *     page beats running four count queries per visit.
 *   - Several of the underlying collections (users, results) require
 *     auth to read directly — the cron uses admin SDK so it can scan
 *     them once and surface the totals to the public.
 *
 * 30-minute cadence: marketing-page numbers don't need to be real-time;
 * a half-hour staleness is invisible to a visitor and saves Firestore
 * read budget. Anyone needing "live" numbers (admin dashboards) reads
 * the source collections directly.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");

const STATS_OPTS = {
  schedule: "every 30 minutes",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const updatePublicStats = onSchedule(STATS_OPTS, async () => {
  const db = admin.firestore();
  const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(Date.now() - SEVEN_DAYS_MS);

  // Run all four counts in parallel — independent reads, fastest wall
  // time for the cron. Aggregate count() is a single read per ~1000
  // matched docs, so even a 10k-row results collection costs <10 reads.
  const [
    learnersSnap,
    gamesPlayedSnap,
    resultsSnap,
    publishedQuizzesSnap,
  ] = await Promise.all([
    db.collection("users").where("role", "==", "learner").count().get(),
    db.collection("scores").where("playedAt", ">=", sevenDaysAgo).count().get(),
    db.collection("results").count().get(),
    db.collection("quizzes").where("status", "==", "published").count().get(),
  ]).catch((err) => {
    console.error("[publicStats] aggregate count failed", err);
    return [null, null, null, null];
  });

  const stats = {
    learners:           learnersSnap?.data().count || 0,
    gamesPlayedThisWeek: gamesPlayedSnap?.data().count || 0,
    quizzesTakenAllTime: resultsSnap?.data().count || 0,
    quizzesAvailable:    publishedQuizzesSnap?.data().count || 0,
    updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("publicStats").doc("global").set(stats, {merge: true});
});

module.exports = {updatePublicStats};
