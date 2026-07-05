"use strict";

// Firestore-backed fixed-window request rate limiter.
//
// Closes the "no per-second / burst throttle" gap on the AI + TTS HTTP and
// callable surfaces: the per-user daily quota (aiService.assertDailyLimit)
// and the monthly spend cap bound totals, but nothing stopped a signed-in
// user (or a leaked ID token) from bursting hundreds of expensive LLM/TTS
// requests per minute up to that daily wall. This adds a short-window cap
// per user (the primary control) plus a generous per-IP backstop.
//
// Design constraints for a production payments/education platform:
//   • FAIL-OPEN everywhere. A jammed limiter (Firestore outage, transaction
//     contention, permission slip) must never take the product down — the
//     daily quota + monthly budget still bound cost downstream.
//   • A request already at/over the cap is NOT counted, so a hammering
//     client can't keep pushing its own window reset further out.
//   • Env-tunable + a master kill-switch so ops can retune or disable on a
//     redeploy with no code change.
//
// Counter docs live in the `rateLimits` collection, keyed per (scope,
// window). They are tiny and self-obsolete (a new window is a new doc); set
// a Firestore TTL policy on the `expireAt` field to reap them.

const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");
const {
  sanitizeKeyPart,
  windowStartFor,
  rateLimitDocId,
  evaluate,
  retryAfterSeconds,
  clientIpFrom,
} = require("./rateLimitCore");

const COLLECTION = "rateLimits";
const WINDOW_MS = 60 * 1000;

// Master kill-switch — set RATE_LIMIT_DISABLED=1 on the deploy to short the
// whole limiter (still records nothing, allows everything).
const DISABLED = process.env.RATE_LIMIT_DISABLED === "1";

function intEnv(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

// Default per-minute caps. A human clicking through the app never approaches
// the per-user cap; a script/loop hits it in seconds. The per-IP cap is
// generous so a school computer-lab NAT (many real learners on one public
// IP) isn't tripped in normal use — it only catches one source spraying
// many synthetic accounts / a leaked token farm.
const POLICY = {
  userPerMin: intEnv("RATE_LIMIT_USER_PER_MIN", 20),
  ipPerMin: intEnv("RATE_LIMIT_IP_PER_MIN", 120),
};

function nowMs(now) {
  return Number.isFinite(now) ? now : Date.now();
}

// Check + consume one slot in a fixed-window bucket. NEVER throws — returns a
// plain result object, allowing the request on any failure (degraded:true).
async function checkRateLimit(db, scope, { limit, windowMs = WINDOW_MS, now } = {}) {
  const t = nowMs(now);
  const windowStart = windowStartFor(t, windowMs);
  const base = {
    scope,
    limit,
    windowMs,
    retryAfterSec: retryAfterSeconds(t, windowStart, windowMs),
  };
  if (DISABLED || !limit || limit <= 0) {
    return { ...base, allowed: true, remaining: limit || 0, degraded: DISABLED };
  }
  const ref = db.collection(COLLECTION).doc(rateLimitDocId(scope, windowStart));
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? Number(snap.data()?.count || 0) : 0;
      const { allowed, remaining } = evaluate(count, limit);
      if (allowed) {
        tx.set(
          ref,
          {
            scope,
            window: windowStart,
            count: admin.firestore.FieldValue.increment(1),
            // For a Firestore TTL policy on `expireAt` — two windows of slack
            // so an in-flight check never races the reaper.
            expireAt: admin.firestore.Timestamp.fromMillis(
              windowStart + windowMs * 2,
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      return { ...base, allowed, remaining };
    });
  } catch (err) {
    console.warn(
      `[rateLimit] check failed for ${scope} (allowing)`,
      (err && err.message) || err,
    );
    return { ...base, allowed: true, remaining: 0, degraded: true };
  }
}

// Evaluate several buckets in order; the first that blocks wins. Ordered
// most-specific first (per-user before per-IP) so the message + Retry-After
// reflect the tightest cap the caller actually hit.
async function enforceRateLimit(db, buckets, { now } = {}) {
  for (const b of buckets) {
    if (!b) continue;
    const result = await checkRateLimit(db, b.scope, {
      limit: b.limit,
      windowMs: b.windowMs,
      now,
    });
    if (!result.allowed) return result;
  }
  return { allowed: true };
}

// Build the standard (per-user + per-IP) bucket set for an action.
function standardBuckets({ action, uid, ip, userPerMin, ipPerMin }) {
  const buckets = [];
  if (uid) {
    buckets.push({
      scope: `${action}:u:${sanitizeKeyPart(uid, 128)}`,
      limit: userPerMin || POLICY.userPerMin,
      windowMs: WINDOW_MS,
    });
  }
  if (ip && ip !== "unknown") {
    buckets.push({
      scope: `${action}:ip:${sanitizeKeyPart(ip, 64)}`,
      limit: ipPerMin || POLICY.ipPerMin,
      windowMs: WINDOW_MS,
    });
  }
  return buckets;
}

function resolveClientIp(req) {
  if (!req) return "unknown";
  const header = req.get
    ? req.get("x-forwarded-for")
    : req.headers && req.headers["x-forwarded-for"];
  const fallback =
    req.ip ||
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress);
  return clientIpFrom(header, fallback);
}

function rateLimitMessage(result) {
  const secs = (result && result.retryAfterSec) || 60;
  return `Too many requests. Please slow down and try again in about ${secs}s.`;
}

function rateLimitError(result) {
  return new HttpsError("resource-exhausted", rateLimitMessage(result));
}

// Advisory rate-limit headers. Never throws (a set() after headers flushed
// would otherwise crash the handler).
function applyRateLimitHeaders(res, result) {
  try {
    if (!res || !result) return;
    if (result.limit) res.set("RateLimit-Limit", String(result.limit));
    if (result.remaining != null) {
      res.set("RateLimit-Remaining", String(result.remaining));
    }
    if (!result.allowed && result.retryAfterSec) {
      res.set("Retry-After", String(result.retryAfterSec));
    }
  } catch (err) {
    /* headers already sent — ignore */
  }
}

// ── Handler-facing guards ────────────────────────────────────────────────

// For onRequest handlers that surface errors by THROWING an HttpsError into a
// try/catch that maps code → status (apiAiChat, the teacher SSE streams).
// Sets advisory headers, then throws resource-exhausted (→ HTTP 429) on a
// block. Fail-open.
async function assertHttpRateLimit(req, res, opts) {
  const ip = resolveClientIp(req);
  const buckets = standardBuckets({ ...opts, ip });
  const result = await enforceRateLimit(admin.firestore(), buckets);
  applyRateLimitHeaders(res, result);
  if (!result.allowed) throw rateLimitError(result);
}

// For onRequest handlers that write responses directly (tts). Returns true
// and sends a 429 when blocked (caller should `return`); false to proceed.
// Fail-open.
async function guardHttpRateLimit(req, res, opts) {
  const ip = resolveClientIp(req);
  const buckets = standardBuckets({ ...opts, ip });
  const result = await enforceRateLimit(admin.firestore(), buckets);
  applyRateLimitHeaders(res, result);
  if (!result.allowed) {
    res.status(429).json({
      error: rateLimitMessage(result),
      retryAfterSec: result.retryAfterSec,
    });
    return true;
  }
  return false;
}

// For onCall handlers — throws resource-exhausted (the client surfaces it
// like the daily-limit error). Pulls uid + IP off the callable request.
// Fail-open.
async function assertCallableRateLimit(request, opts) {
  const uid = request && request.auth && request.auth.uid;
  const ip = request && request.rawRequest
    ? resolveClientIp(request.rawRequest)
    : "unknown";
  const buckets = standardBuckets({ ...opts, uid, ip });
  const result = await enforceRateLimit(admin.firestore(), buckets);
  if (!result.allowed) throw rateLimitError(result);
}

module.exports = {
  POLICY,
  WINDOW_MS,
  checkRateLimit,
  enforceRateLimit,
  standardBuckets,
  resolveClientIp,
  applyRateLimitHeaders,
  rateLimitMessage,
  rateLimitError,
  assertHttpRateLimit,
  guardHttpRateLimit,
  assertCallableRateLimit,
};
