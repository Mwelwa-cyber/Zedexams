/**
 * Rate-limiter health canary (OBS-005 / OBS-004) — turns the fail-open
 * `rate_limit_degraded` telemetry into an actual ops alert.
 *
 * The burst limiter (rateLimit.js) is FAIL-OPEN by design: a jammed Firestore
 * transaction allows the request and logs a structured `rate_limit_degraded`
 * event so the daily quota + hard monthly-budget gate still bound cost. But a
 * log is not an alert — burst protection could be silently degraded for hours.
 *
 * This scheduled canary PROBES the limiter each hour with a synthetic check
 * (a huge limit, so it never blocks — only the transaction path matters) and,
 * when the probe comes back degraded, raises an ops alert. It is:
 *   • edge-triggered — one alert at onset, not one per hour of a sustained
 *     outage (shouldAlertLimiterHealth against the last recorded status);
 *   • kill-switch aware — RATE_LIMIT_DISABLED=1 reads as `disabled`, never an
 *     alert (the limiter is intentionally off, not broken);
 *   • never throwing — a canary that crashes the scheduler helps nobody.
 *
 * The structured log line remains for operators who prefer a GCP log-based
 * metric + alert policy on `rate_limit_degraded` (per-event granularity); this
 * canary is the code-level backstop that needs no GCP alerting config. See
 * docs/production-readiness/11-observability-and-audit.md (OBS-005/OBS-004).
 */

const crypto = require("node:crypto");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const {checkRateLimit} = require("./rateLimit");
const {classifyLimiterHealth, shouldAlertLimiterHealth} = require("./rateLimitHealthCore");
const {sendOpsAlert} = require("./opsAlert");

const emailSmtpUser = defineSecret("EMAIL_SMTP_USER");
const emailSmtpPassword = defineSecret("EMAIL_SMTP_PASSWORD");

// A dedicated synthetic scope with a huge limit: the probe must always be
// "allowed" (we care about the transaction path, not blocking), and its own
// counter must never collide with a real action's bucket.
const PROBE_SCOPE = "__ratelimit_healthprobe__";
const PROBE_LIMIT = 1_000_000;
const STATUS_DOC = "status"; // opsRateLimitHealth/status — the last verdict

function logEvent(fields) {
  try {
    console.log("[rateLimitHealth]", JSON.stringify(fields));
  } catch (_e) {
    console.log("[rateLimitHealth]", fields && fields.status);
  }
}

/**
 * One canary run. All I/O injectable so the plain-node test drives every path
 * (healthy / degraded onset / still-degraded / disabled / recovery) without
 * firebase. Never throws.
 *
 * @param {object} [deps]
 * @param {FirebaseFirestore.Firestore} [deps.db]
 * @param {Function} [deps.check] — checkRateLimit(db, scope, opts)
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {Function} [deps.alert] — sendOpsAlert-compatible
 * @param {Date} [deps.now]
 * @returns {Promise<{status: string, alerted: boolean}>}
 */
async function runRateLimitHealthCheck({
  db = admin.firestore(),
  check = checkRateLimit,
  env = process.env,
  alert = sendOpsAlert,
  now = new Date(),
  correlationId = crypto.randomUUID(),
} = {}) {
  const disabled = env.RATE_LIMIT_DISABLED === "1";

  // Probe the limiter. checkRateLimit never throws (it fails open), but guard
  // anyway so the canary itself can't crash the scheduler.
  let degraded = false;
  try {
    const result = await check(db, PROBE_SCOPE, {limit: PROBE_LIMIT});
    degraded = !!(result && result.degraded);
  } catch (err) {
    // If the probe itself throws, the limiter is definitely not healthy.
    degraded = true;
  }

  const status = classifyLimiterHealth({degraded, disabled});
  const checkedAt = now.toISOString();
  const statusRef = db.collection("opsRateLimitHealth").doc(STATUS_DOC);

  // Read the previous verdict for edge-triggered alerting.
  let previousStatus = null;
  try {
    const snap = await statusRef.get();
    previousStatus = snap.exists ? (snap.data() || {}).status || null : null;
  } catch (_e) { /* best-effort — treat as no prior state */ }

  const alerted = shouldAlertLimiterHealth(status, previousStatus);

  logEvent({event: "ratelimit_health", status, previousStatus, alerted, correlationId, checkedAt});
  // Never write an `undefined` field — the Admin SDK rejects it, which would
  // (silently, via the catch) drop the whole status write on healthy runs.
  const statusDoc = {status, previousStatus, checkedAt, correlationId};
  if (alerted) statusDoc.lastAlertedAt = checkedAt;
  await statusRef.set(statusDoc, {merge: true}).catch(() => {});

  if (alerted) {
    await Promise.resolve(alert({
      title: "Burst rate limiter DEGRADED — fail-open, protection is off",
      severity: "error",
      lines: [
        `correlationId: ${correlationId}  ·  ${checkedAt}`,
        "The synthetic canary found the Firestore-backed burst limiter failing " +
        "open (transaction errors). Per-minute burst protection on AI/TTS " +
        "callables is NOT working right now — requests are allowed unthrottled.",
        "This does NOT exhaust the wallet on its own: the per-user daily quota " +
        "and the HARD monthly-budget reservation gate (aiCostTracking.beginAiCall) " +
        "still bound spend. But investigate Firestore health / the `rateLimits` " +
        "collection. Greppable log event: `rate_limit_degraded`.",
      ],
    })).catch(() => {});
  }

  return {status, alerted};
}

// Hourly canary. us-central1 per the repo region convention for scheduled fns.
const rateLimitHealthCheck = onSchedule({
  schedule: "every 60 minutes",
  region: "us-central1",
  timeoutSeconds: 60,
  memory: "256MiB",
  secrets: [emailSmtpUser, emailSmtpPassword],
}, async () => {
  await runRateLimitHealthCheck();
});

module.exports = {
  rateLimitHealthCheck,
  runRateLimitHealthCheck,
  PROBE_SCOPE,
  PROBE_LIMIT,
};
