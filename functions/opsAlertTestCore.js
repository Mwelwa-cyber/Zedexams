/**
 * Pure decisions behind the admin "send a test ops alert" panel. No Firestore,
 * no SMTP, no network — so it tests under plain `node` (the *Core.js split).
 *
 * The point of the panel is not to send a message; it is to answer "would a real
 * alert reach me?" So a SILENT channel has to explain itself. `sendOpsAlert`
 * already returns a machine skip reason per channel (`webhook-unconfigured`,
 * `smtp-unconfigured`, `webhook-http-403`, …); describeChannel turns that into
 * the sentence an operator can act on, and anything unrecognised is reported as
 * unknown rather than dressed up as either success or a known cause.
 */

// A test alert must never read as an incident: severity `info` (🔵) and a title
// that says so, because the channel it lands in is the one people trust.
const TEST_ALERT_TITLE = "Test alert — nothing is wrong";

// Keep an operator's note short; it is echoed into a channel other people read.
const MAX_NOTE_LENGTH = 200;

/**
 * @param {string} raw
 * @returns {string} single-line, length-capped, control characters stripped
 */
function sanitizeNote(raw) {
  return String(raw == null ? "" : raw)
      // Newlines would forge extra lines in the chat message; control bytes
      // are never legitimate in a note.
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NOTE_LENGTH);
}

/**
 * Build the test alert's payload. `nowIso` is passed in (never read from the
 * clock here) so the test is deterministic.
 *
 * @param {Object} args
 * @param {string} [args.actorEmail] who pressed the button
 * @param {string} [args.actorUid]
 * @param {string} [args.nowIso]
 * @param {string} [args.note] optional operator note
 * @returns {{title: string, severity: string, lines: string[]}}
 */
function buildTestAlert({actorEmail, actorUid, nowIso, note} = {}) {
  const who = String(actorEmail || "").trim() || String(actorUid || "").trim() || "an admin";
  const cleanNote = sanitizeNote(note);
  const lines = [
    "This is a test of the ops-alert channels. No action is needed.",
    `Requested by: ${who}`,
  ];
  if (nowIso) lines.push(`Sent at: ${nowIso}`);
  if (cleanNote) lines.push(`Note: ${cleanNote}`);
  lines.push(
      "If you can read this in chat AND in the admin inbox, both channels work.",
  );
  return {title: TEST_ALERT_TITLE, severity: "info", lines};
}

// Skip reasons sendOpsAlert can report, and what an operator does about each.
const SKIP_EXPLANATIONS = Object.freeze({
  "webhook-unconfigured": "No webhook URL reached this function. Check that the " +
    "OPS_ALERT_WEBHOOK_URL secret exists in Secret Manager and that the latest " +
    "functions deploy succeeded — opsAlertSecrets.js binds it to every alerting " +
    "function, so a stale deployment is the usual cause.",
  "webhook-failed": "The webhook URL could not be reached (network error). " +
    "Check the URL is still valid in the chat app.",
  "no-fetch": "This runtime has no fetch available — a platform problem, not " +
    "a configuration one.",
  "smtp-unconfigured": "EMAIL_SMTP_USER / EMAIL_SMTP_PASSWORD are not bound to " +
    "this function.",
  "no-admin-emails": "OPS_ALERT_EMAILS is empty (and neither ADMIN_EMAILS nor " +
    "an SMTP sender filled in), so there is nobody to email.",
  "send-failed": "SMTP rejected the message. Check the mailbox credentials.",
});

/**
 * Turn one channel result from sendOpsAlert into something displayable.
 * An HTTP status skip (`webhook-http-404`) is explained by its code rather than
 * needing an entry per status.
 *
 * @param {{sent?: boolean, skipped?: string}} [channel]
 * @returns {{status: string, reason: string|null, detail: string|null}}
 */
function describeChannel(channel) {
  if (!channel || typeof channel !== "object") {
    return {status: "unknown", reason: null, detail: "No result was reported for this channel."};
  }
  if (channel.sent === true) return {status: "sent", reason: null, detail: null};

  const reason = channel.skipped ? String(channel.skipped) : null;
  if (!reason) {
    return {status: "unknown", reason: null, detail: "The channel reported neither success nor a reason."};
  }
  const httpMatch = /^webhook-http-(\d{3})$/.exec(reason);
  if (httpMatch) {
    return {
      status: "failed",
      reason,
      detail: `The chat service answered HTTP ${httpMatch[1]}. A 404 usually means the ` +
        "webhook was deleted; re-create it and store the new URL.",
    };
  }
  const detail = SKIP_EXPLANATIONS[reason];
  return {
    status: reason.endsWith("-unconfigured") || reason === "no-admin-emails" ? "not-configured" : "failed",
    reason,
    detail: detail || `Unrecognised reason: ${reason}.`,
  };
}

/**
 * Fold sendOpsAlert's result into the panel's answer.
 *
 * `verdict` is deliberately three-valued: `both` is the only state that proves
 * the OBS-004 property (two independent channels), and `one` is a real warning
 * — an alert would still arrive today, but the redundancy that makes alerting
 * trustworthy is gone.
 *
 * @param {{delivered?: boolean, channels?: Object}} [result]
 * @returns {{verdict: string, delivered: boolean, slack: Object, email: Object}}
 */
function summarizeAlertResult(result) {
  const channels = (result && result.channels) || {};
  const slack = describeChannel(channels.webhook);
  const email = describeChannel(channels.email);
  const sentCount = [slack, email].filter((c) => c.status === "sent").length;
  const verdict = sentCount === 2 ? "both" : sentCount === 1 ? "one" : "none";
  return {
    verdict,
    delivered: Boolean(result && result.delivered) || sentCount > 0,
    slack,
    email,
  };
}

module.exports = {
  TEST_ALERT_TITLE,
  MAX_NOTE_LENGTH,
  sanitizeNote,
  buildTestAlert,
  describeChannel,
  summarizeAlertResult,
};
