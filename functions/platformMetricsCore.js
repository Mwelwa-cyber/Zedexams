/**
 * functions/platformMetricsCore.js
 *
 * Pure, dependency-free helpers for the platform metrics rollup
 * (platformMetrics.js). Import-free — no firebase-admin / firebase-functions —
 * so the repo-root test runner can unit-test it without installing functions/
 * deps, matching visitorTrackingCore.js and cors.js.
 *
 * WHY THIS EXISTS AT ALL
 *
 * The project had two analytics surfaces before this, and neither could answer
 * "how many people used ZedExams today, and did the ones who signed up last
 * week come back":
 *
 *   • visits / visitorStats (visitorTracking.js) counts PAGEVIEWS from an
 *     anonymous browser id. A visit doc carries no uid, and the uniqueness
 *     markers live at visitorStats/{day}/visitors/{visitorId} — scoped INSIDE
 *     one day — so there is no way to ask whether a given visitor returned on
 *     day N+1. The 7d/30d "visitors" tiles on /admin/visitors are sums of daily
 *     uniques, which double-counts anyone who came twice. It is a traffic
 *     counter, not a user counter.
 *
 *   • PostHog (src/utils/analytics.js) does carry a real funnel, but
 *     analyticsPolicy.js deliberately runs LEARNERS (and parents, and every
 *     session before a role resolves) with `identify: false`. That is the
 *     correct call under the children's-privacy policy and must not be undone
 *     to get a metric — but it does mean the learner events land on a rotating
 *     anonymous distinct_id and can never be assembled into a per-user funnel
 *     or a retention cohort. For the audience that matters most, PostHog is
 *     structurally unable to answer the question.
 *
 * So this rollup derives activity FIRST-PARTY, from documents the product
 * already writes as a side effect of learners doing the thing (a quiz result, a
 * game round, an exam attempt). No new client instrumentation, no third party,
 * no cookie-consent dependency, and nothing recorded that the platform was not
 * already storing — the rollup only counts rows that exist.
 *
 * PRIVACY POSTURE. The day doc holds COUNTS only. The uid set needed to join
 * one day to the next lives in a server-only marker subcollection
 * (platformStats/{day}/active/{uid}), mirroring the existing
 * visitorStats/{day}/visitors/{id} shape, carries no name/email/grade, and gets
 * an expiresAt for a Firestore TTL policy so the join data ages out on its own.
 */

// Zambia has no DST and sits at UTC+02:00 year-round, so a "day" here is a
// Lusaka day — the same bucket visitorTrackingCore.js uses. Bucketing on UTC
// instead would roll the day over at 02:00 local time and split a school
// evening's activity across two rows.
const LUSAKA_OFFSET_MINUTES = 120;

/** Marker docs are kept ~13 months: long enough for a full year-on-year term
 * comparison (Term 1 2026 vs Term 1 2027) and for the longest cohort window
 * below, short enough that the join data does not accumulate forever the way
 * `visits` currently does. */
const ACTIVE_MARKER_TTL_DAYS = 400;

/** Retention windows computed for each rolled-up day. D1 is the signal that
 * moves first when onboarding changes; D7 is the one that predicts whether a
 * term subscription renews. */
const RETENTION_WINDOWS = [1, 7, 30];

/**
 * Activity sources. Each is a collection the product ALREADY writes when a
 * learner does something real, with a uid field and a server timestamp.
 *
 * `countAs` names the per-day count surfaced on the day doc, so the same scan
 * that produces the active-user set also produces the engagement counts — one
 * pass, not two.
 *
 * Deliberately NOT included: `visits` (no uid), `users` (a profile write is not
 * activity), `notifications` (delivered TO the user, not BY them).
 */
const ACTIVITY_SOURCES = [
  {collection: "results", timeField: "completedAt", uidField: "userId", countAs: "quizCompletions"},
  {collection: "scores", timeField: "playedAt", uidField: "userId", countAs: "gameRounds"},
  {collection: "exam_attempts", timeField: "submittedAt", uidField: "userId", countAs: "examAttempts"},
];

/**
 * YYYY-MM-DD for the Lusaka day a Date falls in.
 * @param {Date} date
 * @param {number} [offsetMinutes]
 * @returns {string}
 */
function dayKeyFor(date, offsetMinutes = LUSAKA_OFFSET_MINUTES) {
  const shifted = new Date(date.getTime() + offsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Half-open [start, end) UTC instants bounding a Lusaka day key.
 *
 * Half-open on purpose: an inclusive end would double-count a document written
 * exactly at midnight into both adjacent days, which is precisely the kind of
 * off-by-one that makes a retention number quietly wrong rather than obviously
 * broken.
 *
 * @param {string} dayKey YYYY-MM-DD
 * @param {number} [offsetMinutes]
 * @returns {{start: Date, end: Date}}
 */
function dayWindow(dayKey, offsetMinutes = LUSAKA_OFFSET_MINUTES) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey))) {
    throw new TypeError(`dayWindow: expected YYYY-MM-DD, got ${dayKey}`);
  }
  const startMs = Date.parse(`${dayKey}T00:00:00Z`) - offsetMinutes * 60 * 1000;
  return {
    start: new Date(startMs),
    end: new Date(startMs + 24 * 60 * 60 * 1000),
  };
}

/**
 * Shift a day key by whole days. Works through month and year boundaries
 * because it goes via epoch milliseconds rather than string arithmetic.
 * @param {string} dayKey
 * @param {number} deltaDays
 * @returns {string}
 */
function shiftDayKey(dayKey, deltaDays) {
  const {start} = dayWindow(dayKey);
  return dayKeyFor(new Date(start.getTime() + deltaDays * 24 * 60 * 60 * 1000));
}

/**
 * Retention rate as a 0-1 number rounded to 4dp.
 *
 * An EMPTY COHORT RETURNS null, NOT 0. This is the whole reason this is a named
 * function rather than an inline division: on a day when nobody signed up,
 * `retained / cohortSize` is 0/0, and a dashboard that renders that as "0%
 * retention" tells the founder his product collapsed when in fact it has no
 * opinion. null means "no cohort", and the reader must show it as "—".
 *
 * @param {number} retained
 * @param {number} cohortSize
 * @returns {number|null}
 */
function retentionRate(retained, cohortSize) {
  if (!Number.isFinite(cohortSize) || cohortSize <= 0) return null;
  if (!Number.isFinite(retained) || retained < 0) return null;
  return Math.round((retained / cohortSize) * 10000) / 10000;
}

/**
 * Assemble one retention window's record.
 * @param {number} windowDays
 * @param {string} cohortDay
 * @param {number} cohortSize
 * @param {number} retained
 */
function retentionRecord(windowDays, cohortDay, cohortSize, retained) {
  return {
    window: windowDays,
    cohortDay,
    cohortSize,
    retained,
    rate: retentionRate(retained, cohortSize),
  };
}

/**
 * Split an array into fixed-size chunks.
 *
 * Firestore's getAll()/`in` queries cap out (30 for `in`, and a getAll of
 * thousands of refs is a single enormous request), so cohort membership is
 * checked in batches. Kept pure and tested because an off-by-one here silently
 * DROPS users from a cohort — which shows up as retention that looks slightly
 * too good, the least detectable kind of wrong.
 *
 * @param {Array} items
 * @param {number} size
 * @returns {Array<Array>}
 */
function chunk(items, size) {
  if (!Array.isArray(items)) return [];
  const n = Math.max(1, Math.floor(size) || 1);
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * Build the day document from a scan result.
 *
 * Separated from the Firestore calls so the shape — and every derived number on
 * it — is assertable without an emulator.
 *
 * @param {object} input
 * @param {string} input.dayKey
 * @param {Map<string,string>} input.activeByUid uid → role ('' when unknown)
 * @param {Record<string,number>} input.counts per-source event counts
 * @param {number} input.newUsers accounts created during the day
 * @param {Array} input.retention retentionRecord() entries
 * @returns {object}
 */
function buildDayStats({dayKey, activeByUid, counts, newUsers, retention}) {
  const roles = {};
  for (const role of activeByUid.values()) {
    const key = role || "unknown";
    roles[key] = (roles[key] || 0) + 1;
  }
  const retentionByWindow = {};
  for (const r of retention || []) retentionByWindow[`d${r.window}`] = r;

  return {
    day: dayKey,
    // Distinct signed-in users who did something real that day. This is the
    // number /admin/visitors could never produce.
    dau: activeByUid.size,
    activeByRole: roles,
    newUsers: newUsers || 0,
    quizCompletions: counts.quizCompletions || 0,
    gameRounds: counts.gameRounds || 0,
    examAttempts: counts.examAttempts || 0,
    // Total activity events, so "events per active user" (the engagement-depth
    // number behind "addictive") is one division away.
    activityEvents:
      (counts.quizCompletions || 0) +
      (counts.gameRounds || 0) +
      (counts.examAttempts || 0),
    retention: retentionByWindow,
  };
}

module.exports = {
  LUSAKA_OFFSET_MINUTES,
  ACTIVE_MARKER_TTL_DAYS,
  RETENTION_WINDOWS,
  ACTIVITY_SOURCES,
  dayKeyFor,
  dayWindow,
  shiftDayKey,
  retentionRate,
  retentionRecord,
  chunk,
  buildDayStats,
};
