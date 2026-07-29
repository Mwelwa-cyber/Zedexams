"use strict";

/**
 * functions/accountDeletionRequests.js
 *
 * The PUBLIC half of account deletion: the endpoint behind
 * zedexams.com/delete-account, reached through the Hosting rewrite
 * /api/account/delete-request.
 *
 * Google Play requires a way to request deletion that does not involve
 * opening the app. The in-app path (`deleteMyAccount`) already exists and is
 * the one that actually purges; it is authenticated and requires a fresh
 * re-login, because it is irreversible. This endpoint cannot be either of
 * those things — its whole purpose is to serve someone who has lost their
 * password, lost the device, or is a parent acting for a child.
 *
 * So it deliberately DOES NOT DELETE ANYTHING. It records a request that a
 * human verifies out of band, after which the account is deleted through the
 * existing path and the same purge runs. A public endpoint that deleted on
 * demand would let anyone wipe any account by typing its email address.
 *
 * What the code has to get right, given it is unauthenticated:
 *   • Identical response whether or not the address has an account — no
 *     account-enumeration oracle. We never look the address up.
 *   • Rate limited per IP and per email, because it writes a Firestore doc
 *     and sends an ops alert per call.
 *   • Idempotent per email: a second submission while one is pending is
 *     acknowledged without writing a duplicate, so a double-tap or an
 *     impatient resubmit doesn't flood the support queue.
 *
 * Decision logic lives in accountDeletionRequestCore.js (pure, plain-node
 * tested); this file is the I/O shell.
 */

const {onRequest} = require("firebase-functions/v2/https");
const crypto = require("crypto");
const admin = require("firebase-admin");
const {applyCors} = require("./cors");
const {enforceRateLimit, standardBuckets, resolveClientIp} = require("./rateLimit");
const {sendOpsAlert} = require("./opsAlert");
const {
  normalizeDeletionRequest,
  acknowledgement,
} = require("./accountDeletionRequestCore");

const COLLECTION = "deletionRequests";

// Statuses that mean "a human still owes this request an action". A repeat
// submission while one of these is open is a no-op rather than a new row.
const OPEN_STATUSES = ["pending", "verified"];

// Stable, non-reversible key for the per-email rate-limit bucket. Same email
// always lands in the same bucket; the address itself never reaches the
// `rateLimits` collection.
function emailBucketKey(email) {
  return crypto.createHash("sha256").update(String(email)).digest("hex").slice(0, 32);
}

function log(level, event, fields = {}) {
  const line = JSON.stringify({event: `deletion_request_${event}`, ...fields});
  if (level === "error") console.error("[requestAccountDeletion]", line);
  else if (level === "warn") console.warn("[requestAccountDeletion]", line);
  else console.log("[requestAccountDeletion]", line);
}

/**
 * Core handler, split from the onRequest wrapper so it unit-tests with fake
 * req/res and an injected Firestore + limiter (invoking an onRequest needs
 * the functions runtime).
 */
async function handleDeletionRequest(req, res, deps = {}) {
  const db = deps.db || admin.firestore();
  const rateLimitFn = deps.enforceRateLimit || enforceRateLimit;
  const alert = deps.sendOpsAlert || sendOpsAlert;
  const cors = deps.applyCors || applyCors;
  const logFn = deps.log || log;
  const serverTimestamp = deps.serverTimestamp ||
    (() => admin.firestore.FieldValue.serverTimestamp());

  try {
    cors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({error: "Use POST."});
      return;
    }

    const parsed = normalizeDeletionRequest(req.body);
    if (!parsed.ok) {
      // A validation failure is the requester's own form being incomplete —
      // it says nothing about any account, so it is safe to be specific.
      logFn("warn", "rejected", {category: "validation", field: parsed.field});
      res.status(400).json({error: parsed.error, field: parsed.field});
      return;
    }
    const request = parsed.value;

    // Two buckets. The IP cap stops a scripted flood; the per-email cap stops
    // someone using a victim's address to bury support in duplicate rows from
    // a rotating set of IPs. Fail-open (the limiter's own posture) — a
    // degraded limiter must never deny a person their route to deletion.
    const ip = resolveClientIp(req);
    const rl = await rateLimitFn(db, standardBuckets({
      action: "account-deletion-request",
      ip,
      ipPerMin: 5,
      // HASHED, not the address itself. The limiter's scope becomes a
      // Firestore document id in `rateLimits`, which is retained for its own
      // lifecycle and is not reached by the account purge — writing a raw
      // email there would leave the address behind after the account it
      // belongs to has been deleted.
      uid: emailBucketKey(request.email),
      userPerMin: 3,
    })).catch((err) => {
      logFn("warn", "ratelimit_error", {error: String(err?.message || err).slice(0, 200)});
      return {allowed: true, degraded: true};
    });
    if (!rl.allowed) {
      logFn("warn", "rejected", {category: "rate_limited"});
      // 429 with the same neutral wording — still no signal about the account.
      res.status(429).json({
        error: "Too many requests just now. Please try again in a minute, " +
          "or email support@zedexams.com.",
      });
      return;
    }

    // Idempotency: an open request for this address already covers the job.
    // Note this reads our OWN request queue, not the user table — it reveals
    // only whether the same form was submitted before, which the submitter
    // already knows.
    const open = await db.collection(COLLECTION)
      .where("email", "==", request.email)
      .where("status", "in", OPEN_STATUSES)
      .limit(1)
      .get();
    if (!open.empty) {
      logFn("info", "duplicate", {});
      res.status(200).json(acknowledgement());
      return;
    }

    await db.collection(COLLECTION).add({
      ...request,
      ip: ip || null, // abuse investigation only; purged with the request
      userAgent: String(req.get("user-agent") || "").slice(0, 300),
      createdAt: serverTimestamp(),
    });

    // Tell support there is something to verify. Best-effort: a failed alert
    // must not fail the request — the row is already queued and visible in
    // the admin UI, so the requester is served either way.
    try {
      await alert({
        title: "Account deletion requested (web form)",
        severity: "info",
        lines: [
          `Email: ${request.email}`,
          `Name: ${request.name || "(not given)"}`,
          `Account type: ${request.role}`,
          request.details ? `Notes: ${request.details}` : "",
          "",
          "Verify identity against the email on file, then delete the Auth " +
          "user — deleteMyAccount's purge path clears the data.",
        ].filter(Boolean),
      });
    } catch (err) {
      logFn("error", "alert_failed", {error: String(err?.message || err).slice(0, 200)});
    }

    logFn("info", "queued", {});
    res.status(200).json(acknowledgement());
  } catch (err) {
    logFn("error", "failed", {error: String(err?.message || err).slice(0, 200)});
    // Name the fallback channels explicitly: this endpoint failing must not
    // leave someone with no way to exercise the right at all.
    try {
      if (!res.headersSent) {
        res.status(500).json({
          error: "We couldn't submit your request. Please email " +
            "support@zedexams.com or WhatsApp +260 977 740 465.",
        });
      }
    } catch (_e) { /* response already closed */ }
  }
}

/**
 * Close out any open web deletion request for `email`, called from the
 * `deleteMyAccount` purge once the account is actually gone.
 *
 * Two things happen at once, and the second is the point:
 *
 *   • The row is marked `completed`, so support sees the queue drain by
 *     itself when someone finishes the job in-app instead of waiting for a
 *     reply. That is the audit trail: a request was made, and it was honoured.
 *
 *   • The requester's email, name and free-text notes are REDACTED. A record
 *     that we deleted someone's account is worth keeping; their email address
 *     is not, and keeping it would contradict the Privacy Policy's §7 promise
 *     in the one collection created by exercising that very promise. What
 *     remains — the timestamps, the role, the status — carries no identity.
 *
 * Best-effort by design: it is called after the purge has already succeeded,
 * so a failure here must not turn a completed deletion into an error the user
 * sees. Returns the number of rows closed (0 when there was no web request,
 * which is the common in-app case).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} email                    The deleted account's address.
 * @param {object} [deps]
 * @return {Promise<number>}
 */
async function closeDeletionRequests(db, email, deps = {}) {
  const address = String(email || "").trim().toLowerCase();
  if (!address) return 0;
  const serverTimestamp = deps.serverTimestamp ||
    (() => admin.firestore.FieldValue.serverTimestamp());

  const snap = await db.collection(COLLECTION)
    .where("email", "==", address)
    .where("status", "in", OPEN_STATUSES)
    .get();
  if (snap.empty) return 0;

  for (const doc of snap.docs) {
    await doc.ref.update({
      status: "completed",
      completedAt: serverTimestamp(),
      // Redaction, not deletion of the row. The hash keeps the queue
      // de-duplicable without keeping the address.
      email: `redacted:${emailBucketKey(address)}`,
      name: "",
      details: "",
      ip: null,
      userAgent: "",
      redactedAt: serverTimestamp(),
    });
  }
  return snap.size;
}

exports.apiRequestAccountDeletion = onRequest(
    {region: "us-central1", timeoutSeconds: 30, memory: "256MiB"},
    (req, res) => handleDeletionRequest(req, res),
);

// Exported for unit tests (accountDeletionRequests.test.js). The deployed
// surface is apiRequestAccountDeletion above.
exports.handleDeletionRequest = handleDeletionRequest;
exports.closeDeletionRequests = closeDeletionRequests;
exports.emailBucketKey = emailBucketKey;
exports.COLLECTION = COLLECTION;
exports.OPEN_STATUSES = OPEN_STATUSES;
