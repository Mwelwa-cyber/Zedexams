/**
 * Anchor — retention agent (read-only cohort intelligence, drafts only).
 *
 * The existing dailyStreakReminders catches learners who missed *today*.
 * Nothing catches the slower, more dangerous churn: a learner who was genuinely
 * engaged — completed real exams, built a streak — and then went quiet two to
 * four weeks ago. By the time anyone notices, they're gone. Today no one knows
 * who those learners are.
 *
 * Anchor finds them. Each run it scans the at-risk window (learnerStats whose
 * lastActivityDate fell 14–45 days ago) for learners with real prior
 * engagement, buckets them by how long they've been silent, and surfaces the
 * highest-value ones to win back — with a drafted re-engagement nudge. It does
 * NOT message learners (that's a flagged later step that reuses the FCM /
 * WhatsApp paths + their cooldowns); v1's value is the cohort nobody can see.
 *
 * Bounded + cheap: the date-range query targets only the at-risk window (a
 * single-field index on lastActivityDate), never the whole learnerStats
 * collection. Pure aggregation, db injected — unit-tests without Firebase.
 */

const MIN_INACTIVE_DAYS = 14; // less than this, dailyStreakReminders owns it
const MAX_INACTIVE_DAYS = 45; // beyond this, treat as churned, not recoverable
const MIN_ENGAGEMENT = 3; // examsCompleted — worth the effort to win back
const SAMPLE_SIZE = 25;
const MAX_DOCS = 2000;

function clampMessage(err) {
  return String((err && err.message) || err || "").slice(0, 200);
}

function safeInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** YYYY-MM-DD (UTC) for a Date — matches gamificationService's lastActivityDate. */
function ymd(date) {
  return date.toISOString().slice(0, 10);
}

/** Whole days between a YYYY-MM-DD string and a clock (ms). Null on bad input. */
function daysSince(ymdStr, nowMs) {
  const t = Date.parse(`${ymdStr}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.floor((nowMs - t) / (24 * 60 * 60 * 1000));
}

function bucketFor(days) {
  if (days <= 21) return "14-21d";
  if (days <= 30) return "22-30d";
  return "31-45d";
}

/**
 * Identify lapsed-but-recoverable learners from learnerStats records. Pure.
 *
 * @param {Array<{uid, lastActivityDate, examsCompleted, bestPercentage, longestStreak}>} records
 * @param {Object} [opts]
 * @returns {Object} { atRisk, buckets, sample }
 */
function analyzeRetention(records, opts = {}) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const minInactiveDays = opts.minInactiveDays != null ? opts.minInactiveDays : MIN_INACTIVE_DAYS;
  const maxInactiveDays = opts.maxInactiveDays != null ? opts.maxInactiveDays : MAX_INACTIVE_DAYS;
  const minEngagement = opts.minEngagement != null ? opts.minEngagement : MIN_ENGAGEMENT;
  const sampleSize = opts.sampleSize != null ? opts.sampleSize : SAMPLE_SIZE;

  const buckets = {"14-21d": 0, "22-30d": 0, "31-45d": 0};
  const atRisk = [];

  for (const r of records || []) {
    const days = (r && typeof r.lastActivityDate === "string") ? daysSince(r.lastActivityDate, nowMs) : null;
    if (days === null || days < minInactiveDays || days > maxInactiveDays) continue;
    const examsCompleted = safeInt(r.examsCompleted, 0);
    if (examsCompleted < minEngagement) continue;

    atRisk.push({
      uid: (r && r.uid) || null,
      daysInactive: days,
      examsCompleted,
      bestPercentage: safeInt(r.bestPercentage, 0),
      longestStreak: safeInt(r.longestStreak, 0),
    });
    buckets[bucketFor(days)] += 1;
  }

  // Win back the most valuable first: more engaged, and more recently lapsed.
  atRisk.sort((a, b) => b.examsCompleted - a.examsCompleted || a.daysInactive - b.daysInactive);

  const sample = atRisk.slice(0, sampleSize).map((l) => ({
    ...l,
    nudge: `Completed ${l.examsCompleted} exams (best ${l.bestPercentage}%, longest streak ` +
      `${l.longestStreak}) and went quiet ${l.daysInactive} days ago — a "we miss you, ` +
      `here's a fresh quiz" nudge could win them back.`,
  }));

  return {atRisk: atRisk.length, buckets, sample};
}

/**
 * Scan the at-risk window of learnerStats and surface the cohort. db injected.
 *
 * @param {Object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {number} [args.nowMs]
 * @param {number} [args.minInactiveDays]
 * @param {number} [args.maxInactiveDays]
 * @param {number} [args.maxDocs]
 * @param {Object} [args.opts]   forwarded to analyzeRetention
 * @returns {Promise<Object>} summary
 */
async function runAnchor({
  db,
  nowMs = Date.now(),
  minInactiveDays = MIN_INACTIVE_DAYS,
  maxInactiveDays = MAX_INACTIVE_DAYS,
  maxDocs = MAX_DOCS,
  opts = {},
}) {
  const summary = {scanned: 0, atRisk: 0, buckets: {}, sample: [], errors: []};

  // Target the window precisely: lastActivityDate between (now - max) and
  // (now - min). YYYY-MM-DD strings sort lexicographically, so a range query on
  // the single-field index returns only lapsed-but-recoverable learners.
  const lower = ymd(new Date(nowMs - maxInactiveDays * 24 * 60 * 60 * 1000));
  const upper = ymd(new Date(nowMs - minInactiveDays * 24 * 60 * 60 * 1000));

  const records = [];
  try {
    const snap = await db.collection("learnerStats")
        .where("lastActivityDate", ">=", lower)
        .where("lastActivityDate", "<=", upper)
        .orderBy("lastActivityDate", "desc")
        .limit(maxDocs)
        .get();
    snap.forEach((doc) => {
      const x = doc.data() || {};
      records.push({
        uid: doc.id,
        lastActivityDate: x.lastActivityDate,
        examsCompleted: x.examsCompleted,
        bestPercentage: x.bestPercentage,
        longestStreak: x.longestStreak,
      });
    });
  } catch (err) {
    summary.errors.push({stage: "query", message: clampMessage(err)});
    return summary;
  }

  summary.scanned = records.length;
  const r = analyzeRetention(records, {nowMs, minInactiveDays, maxInactiveDays, ...opts});
  summary.atRisk = r.atRisk;
  summary.buckets = r.buckets;
  summary.sample = r.sample;
  return summary;
}

module.exports = {runAnchor, analyzeRetention, MIN_INACTIVE_DAYS, MAX_INACTIVE_DAYS, MIN_ENGAGEMENT};
