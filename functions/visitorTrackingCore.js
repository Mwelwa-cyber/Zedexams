/**
 * functions/visitorTrackingCore.js
 *
 * Pure, dependency-free helpers for the website visitor tracker
 * (apiTrackVisit). Kept import-free — no firebase-admin / firebase-
 * functions — so the repo-root `npm run test:all` can unit-test it
 * without installing functions/ deps (same pattern as cors.js and
 * visualSafetyCore.js).
 *
 * The handler in visitorTracking.js wraps these with the Firestore
 * writes. Everything here is deterministic and side-effect free so the
 * parsing/validation logic is easy to assert in visitorTrackingCore.test.js.
 */

// Zambia has no DST and sits at UTC+02:00 year-round. We bucket each
// pageview into a "Lusaka day" so the admin dashboard's daily rollups
// line up with what a Zambian admin would call "today" — not the UTC
// day, which would roll over at 02:00 local time.
const LUSAKA_OFFSET_MINUTES = 120;

// Control characters to strip from any free-text field before storing.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

// Sharded-counter fan-out. The daily rollup used to increment ONE doc
// (visitorStats/{day}) on every pageview — a Firestore write hotspot (~1
// sustained write/sec/doc). Instead each pageview increments one of
// SHARD_COUNT shard docs (visitorStats/{day}/shards/{0..N-1}), lifting the
// ceiling to ~N writes/sec, and a scheduled aggregator sums the shards back
// into the day doc the admin dashboard reads. 10 shards is the common
// starting point (raise it only if sustained traffic ever approaches
// ~10 pageviews/sec on a single day bucket).
const SHARD_COUNT = 10;

// Counter fields carried on each shard doc and summed into the day doc.
const SHARD_COUNTER_FIELDS = ["pageviews", "botPageviews", "uniqueVisitors", "sessions"];

/**
 * How long a RAW visit document survives.
 *
 * `visits` is one document per pageview and, until this was added, nothing
 * ever removed one: no TTL policy, no reaper, and analyticsPurge.js deletes
 * the PostHog person rather than these. It was the unbounded hotspot
 * docs/architecture/11-firestore-data-model.md has been flagging.
 *
 * 90 days rather than something shorter because the raw docs are the only
 * place the per-visit detail (path, referrer, device, country) exists — the
 * durable history lives in the visitorStats/{day} rollups, which are
 * aggregates and are deliberately NOT expired. So this is the window in which
 * a question like "which pages did that referrer spike land on" can still be
 * answered; beyond it, the daily totals remain forever.
 *
 * CHANGING THIS NUMBER IS NOT ENOUGH ON ITS OWN — it is mirrored in
 * src/features/adminAnalytics/pages/AdminVisitors.jsx, which labels the
 * page-view tile with it, and pinned by test:visitor-retention-mirror. The
 * mirror exists because the dashboard tile used to read "all time" over a
 * collection that genuinely was all-time; the moment a TTL reaps it, that
 * label becomes a quiet lie rather than a visible error.
 */
const VISIT_RETENTION_DAYS = 90;

/**
 * How long a per-day uniqueness MARKER survives
 * (visitorStats/{day}/visitors/{id} and .../sessions/{id}).
 *
 * These are not history — they exist so that a second pageview from the same
 * visitor on the SAME Lusaka day does not double-count uniqueVisitors, and
 * updateDailyRollup only ever reads the marker for the day it is writing. A
 * marker is therefore dead the moment its day ends. Kept a week rather than a
 * day purely as slack for a late-arriving beacon and for clock skew; nothing
 * reads one after its own day closes.
 *
 * Short on purpose: at one document per visitor per day these outgrow the raw
 * visits they support, and they are the reason the fix cannot stop at `visits`.
 */
const VISITOR_MARKER_RETENTION_DAYS = 7;

/**
 * The instant a document written at `now` should expire.
 *
 * Returns a Date, not epoch milliseconds, and that is the whole point of it
 * being a named function: a Firestore TTL policy only acts on a TIMESTAMP
 * field. Write a number and Firestore accepts the document, reports the policy
 * as enabled, and reaps nothing — the exact silent failure that
 * check-ttl-policies.mjs's assertTtlFieldIsTimestamp exists to catch, and that
 * `processedEvents` shipped with until 2026-08-14. Callers wrap this in
 * admin.firestore.Timestamp.fromDate().
 *
 * @param {Date} now
 * @param {number} days
 * @returns {Date}
 */
function expiryFrom(now, days) {
  const base = now instanceof Date && Number.isFinite(now.getTime()) ?
    now.getTime() :
    Date.now();
  const span = Number.isFinite(days) && days > 0 ? days : 0;
  return new Date(base + span * 24 * 60 * 60 * 1000);
}

/**
 * Pick a shard id in [0, SHARD_COUNT) for this write. `rand` is injectable
 * (a function or a raw number) so the distribution is deterministically
 * testable; defaults to Math.random. Always returns a valid in-range integer
 * even for degenerate inputs (NaN, negatives, >=1).
 */
function pickShardId(rand = Math.random) {
  const raw = typeof rand === "function" ? rand() : rand;
  const r = Number.isFinite(raw) ? raw : 0;
  const n = Math.floor(r * SHARD_COUNT);
  return Math.min(SHARD_COUNT - 1, Math.max(0, n));
}

/**
 * Sum an array of shard docs' data into day totals. Missing / non-numeric
 * counter fields count as 0, so a half-populated shard (e.g. one that only
 * ever saw pageviews, never a unique visitor) never NaNs the total. Returns
 * a fresh object with all four counters present.
 */
function sumShards(shardDatas) {
  const totals = {pageviews: 0, botPageviews: 0, uniqueVisitors: 0, sessions: 0};
  if (!Array.isArray(shardDatas)) return totals;
  for (const data of shardDatas) {
    if (!data || typeof data !== "object") continue;
    for (const field of SHARD_COUNTER_FIELDS) {
      const v = data[field];
      if (typeof v === "number" && Number.isFinite(v)) totals[field] += v;
    }
  }
  return totals;
}

/**
 * Day bucket key (YYYY-MM-DD) for a Date, shifted into Lusaka local time.
 * @param {Date|number} date
 * @param {number} [offsetMinutes]
 */
function dayKeyFor(date, offsetMinutes = LUSAKA_OFFSET_MINUTES) {
  const ms = date instanceof Date ? date.getTime() : Number(date);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * Collapse a string to a safe, bounded value: coerce to string, strip
 * control characters, trim, and cap the length. Returns '' for anything
 * non-stringy.
 */
function sanitizeText(value, max = 256) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, max);
}

/**
 * Normalise a pathname for grouping: keep only the path portion (drop
 * query string + hash so /papers?subject=maths and /papers collapse to
 * one row), force a leading slash, cap length. Returns '/' on junk.
 */
function sanitizePath(value, max = 512) {
  let p = sanitizeText(value, max + 256);
  if (!p) return "/";
  const cut = p.search(/[?#]/);
  if (cut !== -1) p = p.slice(0, cut);
  if (!p.startsWith("/")) p = `/${p}`;
  // Collapse accidental double slashes; keep it readable.
  p = p.replace(/\/{2,}/g, "/");
  return p.slice(0, max) || "/";
}

/**
 * Just the host of a referrer URL (so we report "google.com" rather than
 * a full noisy URL with tracking params). Returns '' for same-site /
 * empty / unparseable referrers.
 */
function referrerHost(value) {
  const ref = sanitizeText(value, 1024);
  if (!ref) return "";
  try {
    return new URL(ref).host.replace(/^www\./, "").slice(0, 128);
  } catch {
    return "";
  }
}

/**
 * Lightweight User-Agent classification. We deliberately keep this coarse
 * (device class + browser + OS family) — enough for an admin to see the
 * shape of their traffic, without a heavyweight UA-parsing dependency.
 * @param {string} ua
 * @returns {{device: string, browser: string, os: string, bot: boolean}}
 */
function parseUserAgent(ua) {
  const s = typeof ua === "string" ? ua : "";
  const lower = s.toLowerCase();

  const bot = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|preview|headless|lighthouse|pingdom|uptimerobot|curl|wget|python-requests|axios|node-fetch/.test(
      lower,
  );

  let os = "Other";
  if (/windows nt/.test(lower)) os = "Windows";
  else if (/android/.test(lower)) os = "Android";
  else if (/iphone|ipad|ipod/.test(lower)) os = "iOS";
  else if (/mac os x|macintosh/.test(lower)) os = "macOS";
  else if (/cros/.test(lower)) os = "ChromeOS";
  else if (/linux/.test(lower)) os = "Linux";

  let device = "desktop";
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(lower)) device = "tablet";
  else if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|bb10/.test(lower)) device = "mobile";
  if (bot) device = "bot";

  let browser = "Other";
  if (/edg(a|ios|e)?\//.test(lower)) browser = "Edge";
  else if (/opr\/|opera/.test(lower)) browser = "Opera";
  else if (/samsungbrowser/.test(lower)) browser = "Samsung Internet";
  else if (/firefox|fxios/.test(lower)) browser = "Firefox";
  else if (/chrome|crios|chromium/.test(lower)) browser = "Chrome";
  else if (/safari/.test(lower) && /version\//.test(lower)) browser = "Safari";

  return {device, browser, os, bot};
}

/**
 * Validate + normalise the beacon body posted by the client. Returns a
 * clean payload or null when there's nothing trackable. visitorId and
 * sessionId are optional (the client only persists a visitorId when the
 * user has accepted analytics consent) — when absent we still record the
 * pageview, we just can't attribute it to a returning visitor.
 *
 * @param {object} body
 * @returns {{path: string, visitorId: string, sessionId: string,
 *            referrerHost: string, title: string} | null}
 */
function normalizeBeacon(body) {
  if (!body || typeof body !== "object") return null;
  const path = sanitizePath(body.path);
  if (!path) return null;
  // An id, if present, must look like an opaque token — reject anything
  // that could be an attempt to smuggle markup / long junk.
  const cleanId = (v) => {
    const id = sanitizeText(v, 64);
    return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : "";
  };
  return {
    path,
    visitorId: cleanId(body.visitorId),
    sessionId: cleanId(body.sessionId),
    referrerHost: referrerHost(body.referrer),
    title: sanitizeText(body.title, 160),
  };
}

module.exports = {
  LUSAKA_OFFSET_MINUTES,
  SHARD_COUNT,
  SHARD_COUNTER_FIELDS,
  VISIT_RETENTION_DAYS,
  VISITOR_MARKER_RETENTION_DAYS,
  expiryFrom,
  dayKeyFor,
  pickShardId,
  sumShards,
  sanitizeText,
  sanitizePath,
  referrerHost,
  parseUserAgent,
  normalizeBeacon,
};
