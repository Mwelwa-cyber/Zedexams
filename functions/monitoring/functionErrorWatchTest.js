"use strict";

/**
 * "Would a Cloud Function error actually reach me?" — the synthetic proof.
 *
 * Admin-only callable that injects one synthetic memory-kill entry and runs
 * **`runFunctionErrorWatch` itself**: the real classifier, the real message
 * builder, the real `sendOpsAlert` channel, the real secret bindings.
 *
 * That is the whole point, and it is the difference between a test worth
 * having and a decorative one. A synthetic test that composed its own message
 * and posted it directly would prove the mailer works and nothing at all about
 * whether a genuine OOM reaches anyone — it would skip the classifier, the
 * threshold logic, the cooldown, and every binding in between. Those are the
 * parts that break. #1991 is the precedent: an ops webhook was never bound to
 * any function, deploys passed because an *unreferenced* secret is never
 * validated, and email kept working — so alerts kept arriving and nobody knew
 * half the alarm was dead. It was found by pressing a button that fired the
 * real path.
 *
 * Two deliberate differences from a live run:
 *
 *   • it writes to a SCRATCH state document, so pressing the button cannot
 *     consume the real cooldown and mask a genuine memory kill minutes later;
 *   • the injected message is tagged as a drill, so nobody reads the resulting
 *     page as a live incident.
 */
const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {assertVerifiedAuth} = require("../authGuard");
const {isAdminRole} = require("../aiService");
const {runFunctionErrorWatch} = require("./functionErrorWatch");

const REGION = "us-central1";
const SCRATCH_STATE_DOC = "opsMonitorState/functionErrorsDrill";
const THROTTLE_MS = 5 * 60_000;

/** The synthetic entry. Real enough to classify, obvious enough to ignore. */
function drillEntry() {
  return {
    functionName: "zedexams-alarm-drill",
    message:
      "Memory limit of 128 MiB exceeded — SYNTHETIC ALARM DRILL, not a real incident. " +
      "Triggered from /admin Developer tools to prove Cloud Functions alerts are delivered.",
    severity: "ERROR",
  };
}

/**
 * @param {Array} secrets Bindings, so this proves the real secret wiring.
 */
function createSendTestFunctionErrorAlert(secrets = []) {
  return onCall({
    secrets,
    region: REGION,
    timeoutSeconds: 60,
    memory: "256MiB",
  }, async (request) => {
    const uid = await assertVerifiedAuth(request, "Sign in required.");

    const db = admin.firestore();
    const userSnap = await db.collection("users").doc(uid).get();
    const role = userSnap.exists ? (userSnap.data()?.role || "") : "";
    if (!isAdminRole(role)) {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    // Throttle per admin: a drill that can be looped is a way to mail-bomb the
    // ops address from an authenticated session.
    const throttleRef = db.doc(`opsMonitorState/drillThrottle_${uid}`);
    const now = Date.now();
    const prev = await throttleRef.get().catch(() => null);
    const lastAt = Number(prev?.data()?.lastAt ?? 0);
    if (Number.isFinite(lastAt) && now - lastAt < THROTTLE_MS) {
      throw new HttpsError(
        "resource-exhausted",
        "A drill was run in the last 5 minutes. Wait, then try again.",
      );
    }
    await throttleRef.set({lastAt: now, uid}, {merge: true});

    // The real path. Scratch state so a drill can never eat the cooldown that
    // a genuine memory kill would need minutes later.
    const result = await runFunctionErrorWatch({
      db,
      now,
      injectedEntries: [drillEntry()],
      stateDoc: SCRATCH_STATE_DOC,
    });

    return {
      ok: true,
      alerted: Boolean(result.alerted),
      // If this is false, the classifier or the thresholds are broken — the
      // alarm did not merely fail to deliver, it declined to fire.
      firedThroughRealPath: Boolean(result.alerted),
      summary: result.summary ?? null,
      note: result.alerted ?
        "A synthetic critical alert was raised through the live path. Check email and the ops webhook." :
        "The watch did NOT raise an alert for a synthetic memory kill — the classifier or thresholds are broken.",
    };
  });
}

module.exports = {
  createSendTestFunctionErrorAlert,
  drillEntry,
  SCRATCH_STATE_DOC,
};
