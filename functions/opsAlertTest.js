/**
 * sendTestOpsAlert — admin-only callable behind the "Send test alert" panel on
 * /admin. It fires ONE real ops alert through the ordinary `sendOpsAlert` path
 * and reports, per channel, whether it got out.
 *
 * Why it exists: until something actually broke, nobody could tell whether the
 * alerting channels were configured — a webhook that was never bound and a
 * mailbox with a stale password both look exactly like a quiet week. Waiting
 * for a real incident to find out is the wrong time to find out.
 *
 * It deliberately uses the SAME code path a real alert takes (no dry run, no
 * separate transport), because a test that skips the machinery under test
 * proves nothing. What makes it safe instead is the payload: severity `info`
 * and a title that says nothing is wrong (see opsAlertTestCore.js).
 *
 * Firestore-backed throttle: one test alert per admin per 5 minutes, shared
 * across instances via the existing rateLimit helper, so a double-click or an
 * impatient operator can't spam a channel other people read. The limiter fails
 * OPEN by design (see rateLimit.js) — an unavailable limiter must not block a
 * legitimate operational check.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {assertVerifiedAuth} = require("./authGuard");
const {isAdminRole} = require("./aiService");
const {sendOpsAlert} = require("./opsAlert");
const {buildTestAlert, summarizeAlertResult} = require("./opsAlertTestCore");
const {checkRateLimit} = require("./rateLimit");

const REGION = "us-central1";
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_LIMIT = 1;

/**
 * @param {Function} smtpSecretsFn returns {senderEmail, senderPassword} from the
 *   caller's bound secrets — passed in so this module doesn't re-declare them.
 * @param {Array} secrets the function's secret bindings (see opsAlertSecrets)
 */
function createSendTestOpsAlert(smtpSecretsFn, secrets = []) {
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

    const limit = await checkRateLimit(db, `opsAlertTest:${uid}`, {
      limit: THROTTLE_LIMIT,
      windowMs: THROTTLE_WINDOW_MS,
    });
    if (!limit.allowed) {
      throw new HttpsError(
          "resource-exhausted",
          `One test alert every ${THROTTLE_WINDOW_MS / 60000} minutes. ` +
          `Try again in ${limit.retryAfterSec}s.`,
          {retryAfterSec: limit.retryAfterSec},
      );
    }

    const actorEmail = request.auth?.token?.email || userSnap.data()?.email || "";
    const {title, severity, lines} = buildTestAlert({
      actorEmail,
      actorUid: uid,
      nowIso: new Date().toISOString(),
      note: request.data?.note,
    });

    const {senderEmail, senderPassword} = smtpSecretsFn();
    const result = await sendOpsAlert({
      title,
      severity,
      lines,
      smtpUser: senderEmail,
      smtpPassword: senderPassword,
      opsAlertEmails: process.env.OPS_ALERT_EMAILS,
      adminEmails: process.env.ADMIN_EMAILS,
      fallbackSender: senderEmail,
    });

    const summary = summarizeAlertResult(result);
    console.log("[sendTestOpsAlert]", JSON.stringify({
      uid, verdict: summary.verdict,
      slack: summary.slack.status, email: summary.email.status,
    }));
    return summary;
  });
}

module.exports = {createSendTestOpsAlert, THROTTLE_WINDOW_MS};
