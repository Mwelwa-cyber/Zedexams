"use strict";

/**
 * App Check for HTTP (`onRequest`) surfaces: the soft-verify gate and the
 * health-telemetry writer behind it.
 *
 * Both lived in functions/index.js, reachable only by handlers written there.
 * `apiTextToSpeech` lives in its own module (functions/tts.js) and so could not
 * join the graduated-enforcement set at all — which is
 * SECURITY_ENDPOINT_AUDIT.md §4.2, "the priciest per-call surface should join
 * the soft-verify + graduated-enforcement set".
 *
 * They moved HERE rather than being copied there, because the writer is
 * sampled and sharded: a second copy would be a second sampling decision and a
 * second shard-picking rule, drifting silently while both still "record health".
 * One writer, many consumers.
 *
 * Enforcement is graduated and OFF by default — see functions/appCheckEnforcement.js.
 * Observe-only records counters and never blocks; APPCHECK_ENFORCE_LABELS
 * canaries one endpoint; APPCHECK_ENFORCE=1 enforces globally.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
const {resolveAppCheckEnforcement} = require("./appCheckEnforcement");
const {
  resolveShardCount,
  resolveSampleRate,
  weightForSampleRate,
  shouldSample,
  pickShardId,
  classifyOutcome,
  buildHealthShardUpdate,
} = require("./appCheckHealthCore");

// Resolved once at module load, like every other consumer of this resolver.
const APPCHECK_ENFORCEMENT = resolveAppCheckEnforcement(process.env);

function shouldEnforceAppCheck(label) {
  return APPCHECK_ENFORCEMENT.enforces(label);
}

/**
 * Shared writer for the App Check health telemetry. Sampled (only a fraction of
 * requests write) and sharded (writes fan out across N docs) so it can never
 * serialise the request path on one hot daily document. ALWAYS best-effort:
 * sampling-out and any Firestore error are swallowed, so a metrics failure can
 * never fail or delay App Check verification.
 */
async function recordAppCheckHealth({label, tokenPresent, verified, canDistinguishInvalid}) {
  try {
    const sampleRate = resolveSampleRate();
    if (!shouldSample(sampleRate)) return; // not selected → no write
    const date = new Date().toISOString().slice(0, 10);
    const shardCount = resolveShardCount();
    const shardId = pickShardId(shardCount);
    const outcome = classifyOutcome({tokenPresent, verified, canDistinguishInvalid});
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const update = buildHealthShardUpdate({
      label, outcome, weight: weightForSampleRate(sampleRate), inc,
    });
    update.date = date;
    update.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await admin.firestore()
        .collection("appCheckHealth").doc(date)
        .collection("shards").doc(String(shardId))
        .set(update, {merge: true});
  } catch (err) {
    console.warn(`[appCheck:${label}] health write failed`, err?.message || err);
  }
}

/**
 * Audit B3 — soft App Check verification for HTTP endpoints.
 *
 * In rollout mode (the default while clients propagate the App Check SDK init),
 * missing or invalid tokens are counted but the call is NOT rejected. Flipping
 * a label into enforcement makes this throw `permission-denied` instead; the
 * caller decides how that reaches the wire, because these endpoints do not
 * share one error shape.
 */
async function softVerifyAppCheckHttp(req, label) {
  const token = req.get("X-Firebase-AppCheck") || "";
  let verified = null;
  if (token) {
    try {
      verified = await admin.appCheck().verifyToken(token);
    } catch (err) {
      console.warn(`[appCheck:${label}] verifyToken failed`, err?.message || err);
    }
  }
  await recordAppCheckHealth({
    label,
    tokenPresent: Boolean(token),
    verified: Boolean(verified),
    canDistinguishInvalid: true, // HTTP path: token-but-unverified == invalid
  });
  if (shouldEnforceAppCheck(label) && !verified) {
    throw new HttpsError("permission-denied", "App Check verification failed.");
  }
  return verified;
}

module.exports = {
  shouldEnforceAppCheck,
  recordAppCheckHealth,
  softVerifyAppCheckHttp,
};
