/**
 * Platform metrics rollup — DAU, new users, engagement counts and D1/D7/D30
 * retention, derived first-party from documents the product already writes.
 *
 * See platformMetricsCore.js for WHY this exists (short version: visitorStats
 * counts anonymous pageviews with no uid, and PostHog deliberately never
 * identifies learners, so neither surface can answer "how many people used the
 * platform today, and did last week's signups come back").
 *
 * WHAT IT WRITES
 *
 *   platformStats/{YYYY-MM-DD} = {
 *     day, dau, wau, activeByRole, newUsers,
 *     quizCompletions, gameRounds, examAttempts, activityEvents,
 *     retention: { d1: {...}, d7: {...}, d30: {...} },
 *     scannedDocs, truncated, computedAt
 *   }
 *   platformStats/{YYYY-MM-DD}/active/{uid} = { role, expiresAt }
 *
 * The `active` markers are the join key. Retention for the day being rolled up
 * needs no markers at all (the active set is in memory), but WAU and any future
 * cohort question does, and this is the same shape visitorStats/{day}/visitors
 * already uses. Markers carry no name, email or grade — a uid, a role string
 * and a TTL stamp.
 *
 * ENABLE THE TTL (one-off, or the markers accumulate the way `visits` does):
 *   gcloud firestore fields ttls update expiresAt \
 *     --collection-group=active --enable-ttl \
 *     --project=examsprepzambia --database='(default)'
 *
 * BACKFILL. The rollup reads historical documents, so past days can be
 * computed retroactively — you do not have to wait a month to see a trend.
 * See scripts/backfill-platform-stats.mjs.
 *
 * COST. One pass over the day's activity docs, plus one users lookup per
 * distinct active uid. At the scale this ships into that is a few thousand
 * reads a night. The per-source scan is bounded by MAX_DOCS_PER_SOURCE and the
 * day doc records `truncated` when a bound bites — a metric that silently
 * undercounts is worse than no metric, so the cap is reported, never hidden.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {
  ACTIVE_MARKER_TTL_DAYS,
  ACTIVITY_SOURCES,
  RETENTION_WINDOWS,
  buildDayStats,
  chunk,
  dayKeyFor,
  dayWindow,
  retentionRecord,
  shiftDayKey,
} = require("./platformMetricsCore");

/**
 * Per-source scan bound. Generous relative to current volume; present so a
 * runaway collection can never turn the nightly cron into an unbounded read.
 * Crossing it sets `truncated` on the day doc AND logs — see the header.
 */
const MAX_DOCS_PER_SOURCE = 200000;

/** getAll() batch size for resolving uid → role. */
const USER_LOOKUP_BATCH = 300;

/** Firestore caps a WriteBatch at 500 operations. */
const WRITE_BATCH_SIZE = 450;

/**
 * WAU reads the previous 6 days' marker subcollections. Bounded so a viral week
 * cannot make the nightly job read millions of docs; when the bound bites, WAU
 * is reported as null rather than as a number that is quietly too small.
 */
const MAX_WAU_MARKERS = 250000;

/**
 * Scan one activity source for a day, returning the uids seen and the event
 * count.
 *
 * `.select()` with no field names fetches document IDs only — the uid is read
 * from a projection of the single field we need, so a day with 50k quiz results
 * does not pull 50k full documents across the wire.
 */
async function scanSource(db, source, {start, end}) {
  const uids = new Set();
  let count = 0;
  let truncated = false;

  const snap = await db
      .collection(source.collection)
      .where(source.timeField, ">=", admin.firestore.Timestamp.fromDate(start))
      .where(source.timeField, "<", admin.firestore.Timestamp.fromDate(end))
      .select(source.uidField)
      .limit(MAX_DOCS_PER_SOURCE)
      .get();

  for (const doc of snap.docs) {
    count += 1;
    const uid = doc.get(source.uidField);
    // A row without a uid is still an event (it happened) but cannot be an
    // active USER. Counting it in `dau` would inflate the number that matters
    // most, so it lands in the event count only.
    if (typeof uid === "string" && uid) uids.add(uid);
  }
  if (snap.size >= MAX_DOCS_PER_SOURCE) {
    truncated = true;
    console.warn(
        `[platformMetrics] ${source.collection} hit MAX_DOCS_PER_SOURCE ` +
      `(${MAX_DOCS_PER_SOURCE}) — counts for this day are a FLOOR, not a total`,
    );
  }
  return {uids, count, truncated};
}

/** Resolve uid → role for the active set, in bounded getAll batches. */
async function resolveRoles(db, uids) {
  const byUid = new Map();
  for (const batch of chunk([...uids], USER_LOOKUP_BATCH)) {
    const refs = batch.map((uid) => db.collection("users").doc(uid));
    const snaps = await db.getAll(...refs, {fieldMask: ["role"]});
    snaps.forEach((snap, i) => {
      // A missing user doc means the account was deleted (or predates the
      // field). The session still happened, so the uid stays in the active set
      // with an empty role — buildDayStats files it under 'unknown'.
      byUid.set(batch[i], (snap.exists && snap.get("role")) || "");
    });
  }
  return byUid;
}

/** uids of accounts created inside a day window. */
async function cohortUids(db, dayKey) {
  const {start, end} = dayWindow(dayKey);
  const snap = await db
      .collection("users")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
      .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
      .select()
      .get();
  return snap.docs.map((d) => d.id);
}

/** Distinct uids active across the 7-day window ending on dayKey. */
async function weeklyActiveUsers(db, dayKey, todaysActive) {
  const seen = new Set(todaysActive);
  let scanned = todaysActive.size;
  for (let back = 1; back <= 6; back += 1) {
    const prior = shiftDayKey(dayKey, -back);
    const snap = await db
        .collection("platformStats").doc(prior)
        .collection("active")
        .select()
        .limit(MAX_WAU_MARKERS)
        .get();
    scanned += snap.size;
    if (scanned > MAX_WAU_MARKERS) {
      console.warn("[platformMetrics] WAU marker scan exceeded cap — reporting wau=null");
      return null;
    }
    for (const d of snap.docs) seen.add(d.id);
  }
  return seen.size;
}

/**
 * Compute and persist the rollup for one Lusaka day.
 * Exported so the backfill script and tests can drive it directly.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} dayKey YYYY-MM-DD
 * @returns {Promise<object>} the written document
 */
async function rollUpDay(db, dayKey) {
  const window = dayWindow(dayKey);

  const scans = await Promise.all(
      ACTIVITY_SOURCES.map((s) => scanSource(db, s, window)),
  );

  const activeUids = new Set();
  const counts = {};
  let truncated = false;
  let scannedDocs = 0;
  scans.forEach((scan, i) => {
    counts[ACTIVITY_SOURCES[i].countAs] = scan.count;
    scannedDocs += scan.count;
    truncated = truncated || scan.truncated;
    for (const uid of scan.uids) activeUids.add(uid);
  });

  const [activeByUid, newUsersSnap] = await Promise.all([
    resolveRoles(db, activeUids),
    db.collection("users")
        .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(window.start))
        .where("createdAt", "<", admin.firestore.Timestamp.fromDate(window.end))
        .count().get(),
  ]);

  // Retention: every window's cohort is joined against TODAY's active set,
  // which is already in memory — so N windows cost N cohort queries, not N
  // scans of historical activity.
  const retention = await Promise.all(
      RETENTION_WINDOWS.map(async (days) => {
        const cohortDay = shiftDayKey(dayKey, -days);
        const cohort = await cohortUids(db, cohortDay);
        const retained = cohort.filter((uid) => activeByUid.has(uid)).length;
        return retentionRecord(days, cohortDay, cohort.length, retained);
      }),
  );

  // Markers first: WAU for tomorrow depends on today's markers existing, and a
  // half-written day is better detected by a missing summary doc than by a
  // summary doc pointing at markers that were never written.
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + ACTIVE_MARKER_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  const activeCol = db.collection("platformStats").doc(dayKey).collection("active");
  for (const batchUids of chunk([...activeByUid.keys()], WRITE_BATCH_SIZE)) {
    const batch = db.batch();
    for (const uid of batchUids) {
      batch.set(activeCol.doc(uid), {role: activeByUid.get(uid) || "", expiresAt});
    }
    await batch.commit();
  }

  const wau = await weeklyActiveUsers(db, dayKey, new Set(activeByUid.keys()));

  const stats = {
    ...buildDayStats({
      dayKey,
      activeByUid,
      counts,
      newUsers: newUsersSnap.data().count || 0,
      retention,
    }),
    wau,
    scannedDocs,
    truncated,
    computedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection("platformStats").doc(dayKey).set(stats, {merge: true});
  console.log(
      `[platformMetrics] ${dayKey}: dau=${stats.dau} wau=${wau} new=${stats.newUsers} ` +
    `events=${stats.activityEvents} d1=${stats.retention.d1?.rate} d7=${stats.retention.d7?.rate}`,
  );
  return stats;
}

/**
 * Nightly at 00:30 Lusaka, rolling up the day that just ENDED.
 *
 * Not midnight: a job that fires exactly at the boundary races the last writes
 * of the day it is measuring, and a retention number that changes depending on
 * how fast the cron started is not a number anyone can act on.
 */
const rollUpPlatformMetrics = onSchedule(
    {
      schedule: "30 0 * * *",
      timeZone: "Africa/Lusaka",
      region: "us-central1",
      timeoutSeconds: 540,
      memory: "512MiB",
    },
    async () => {
      const db = admin.firestore();
      const yesterday = shiftDayKey(dayKeyFor(new Date()), -1);
      try {
        await rollUpDay(db, yesterday);
      } catch (err) {
      // Loud, because silence here looks exactly like a quiet day.
        console.error(`[platformMetrics] rollup failed for ${yesterday}`, err);
        throw err;
      }
    },
);

module.exports = {rollUpPlatformMetrics, rollUpDay};
