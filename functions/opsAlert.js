/**
 * Shared ops-alert helper — one place to notify admins when a backend failure
 * needs a human, instead of every module re-implementing nodemailer.
 *
 * TWO independent delivery channels (OBS-004 — email alone was a single point
 * of failure: a bad SMTP cred or an unconfigured mailbox silently dropped every
 * critical alert):
 *   • email   — the existing SMTP transport (mail.privateemail.com) +
 *               EMAIL_SMTP_USER / EMAIL_SMTP_PASSWORD secrets + ADMIN_EMAILS.
 *   • webhook — a Slack-compatible incoming webhook at OPS_ALERT_WEBHOOK_URL
 *               (Slack/Discord/Mattermost/generic all accept a JSON `{text}`).
 * The two are delivered in PARALLEL and are fully independent — one failing or
 * being unconfigured never blocks the other, so a critical alert gets out as
 * long as EITHER channel works. Both are best-effort (never throw). Configure
 * one or both; if neither is configured the caller should still have logged the
 * underlying failure.
 *
 * The pure helpers (parseAdminEmails, buildOpsAlertEmail, buildOpsAlertWebhook)
 * carry no dependencies so they unit-test under plain `node` with no firebase /
 * nodemailer install. `sendOpsAlert` lazy-requires nodemailer only when it
 * actually has an email to send, keeping the pure-logic tests clean.
 */

/**
 * Split the ADMIN_EMAILS env var into a clean, de-duplicated list.
 * @param {string} raw
 * @returns {string[]}
 */
function parseAdminEmails(raw) {
  const seen = new Set();
  return String(raw || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => {
      if (!e || seen.has(e)) return false;
      seen.add(e);
      return true;
    });
}

/**
 * Build the {subject, text} of an ops-alert email. Pure — no I/O.
 * @param {Object} args
 * @param {string} args.title    short alert title
 * @param {string[]} [args.lines] body lines
 * @param {string} [args.severity] e.g. "critical" | "warning"
 * @returns {{subject: string, text: string}}
 */
function buildOpsAlertEmail({title, lines = [], severity = "warning"}) {
  const sev = String(severity || "warning").toUpperCase();
  const subject = `[ZedExams ops] ${sev}: ${title}`;
  const body = [
    `Severity: ${sev}`,
    `Alert: ${title}`,
    "",
    ...lines.map((l) => String(l)),
    "",
    "— ZedExams automated ops alert. This is sent to ADMIN_EMAILS.",
  ].join("\n");
  return {subject, text: body};
}

// Severity → a leading marker for the webhook message (Slack renders these).
const SEVERITY_EMOJI = Object.freeze({
  critical: "🔴", error: "🔴", warning: "🟠", info: "🔵",
});

/**
 * Build the Slack-compatible webhook payload. Pure — no I/O. A single `text`
 * field is understood by Slack, Discord, Mattermost and generic JSON
 * receivers, so the same payload works everywhere.
 * @param {Object} args
 * @param {string} args.title
 * @param {string[]} [args.lines]
 * @param {string} [args.severity]
 * @returns {{text: string}}
 */
function buildOpsAlertWebhook({title, lines = [], severity = "warning"}) {
  const sev = String(severity || "warning").toLowerCase();
  const emoji = SEVERITY_EMOJI[sev] || "🟠";
  const header = `${emoji} *[ZedExams ops] ${sev.toUpperCase()}:* ${title}`;
  return {text: [header, ...lines.map((l) => String(l))].join("\n")};
}

/**
 * Deliver the email channel. Best-effort; returns a structured result.
 * @returns {Promise<{sent: boolean, skipped?: string, recipients?: number}>}
 */
async function sendEmailAlert({title, lines, severity, smtpUser, smtpPassword, adminEmails}) {
  const user = String(smtpUser || process.env.EMAIL_SMTP_USER || "").trim();
  const pass = String(smtpPassword || process.env.EMAIL_SMTP_PASSWORD || "").trim();
  const recipients = parseAdminEmails(
    adminEmails != null ? adminEmails : process.env.ADMIN_EMAILS,
  );

  if (!user || !pass) return {sent: false, skipped: "smtp-unconfigured"};
  if (!recipients.length) return {sent: false, skipped: "no-admin-emails"};

  const {subject, text} = buildOpsAlertEmail({title, lines, severity});
  try {
    // Lazy require: nodemailer is a functions/ dependency, not a repo-root
    // one, so requiring it at module load would break the plain-node tests
    // that import the pure helpers above.
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: "mail.privateemail.com",
      port: 587,
      secure: false,
      auth: {user, pass},
    });
    await transporter.sendMail({
      from: `ZedExams ops <${user}>`,
      sender: user,
      to: recipients.join(", "),
      subject,
      text,
    });
    return {sent: true, recipients: recipients.length};
  } catch (err) {
    console.error("[opsAlert] sendMail failed", err && err.message);
    return {sent: false, skipped: "send-failed"};
  }
}

/**
 * Deliver the webhook channel. Best-effort; returns a structured result.
 * @param {string} url  the incoming-webhook URL (OPS_ALERT_WEBHOOK_URL)
 * @param {{text: string}} payload
 * @param {{fetchImpl?: Function}} [opts]
 * @returns {Promise<{sent: boolean, skipped?: string}>}
 */
async function postOpsWebhook(url, payload, {fetchImpl} = {}) {
  if (!url) return {sent: false, skipped: "webhook-unconfigured"};
  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return {sent: false, skipped: "no-fetch"};
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(payload),
    });
    const status = res && res.status;
    const okFlag = res && (res.ok === true || (status >= 200 && status < 300));
    return okFlag ? {sent: true} : {sent: false, skipped: `webhook-http-${status}`};
  } catch (err) {
    console.error("[opsAlert] webhook post failed", err && err.message);
    return {sent: false, skipped: "webhook-failed"};
  }
}

/**
 * Send an ops alert across BOTH channels (email + webhook), in parallel and
 * independently. Best-effort: never throws. `delivered` is true if EITHER
 * channel got the alert out — so a single-channel failure no longer loses a
 * critical alert (OBS-004).
 *
 * @param {Object} args
 * @param {string} args.title
 * @param {string[]} [args.lines]
 * @param {string} [args.severity]
 * @param {string} [args.smtpUser]      EMAIL_SMTP_USER
 * @param {string} [args.smtpPassword]  EMAIL_SMTP_PASSWORD
 * @param {string} [args.adminEmails]   ADMIN_EMAILS (defaults to env)
 * @param {string} [args.webhookUrl]    OPS_ALERT_WEBHOOK_URL (defaults to env)
 * @param {Function} [args.fetchImpl]   injected fetch (tests)
 * @returns {Promise<{sent: boolean, delivered: boolean,
 *   channels: {email: object, webhook: object}}>}
 */
async function sendOpsAlert({
  title,
  lines = [],
  severity = "warning",
  smtpUser,
  smtpPassword,
  adminEmails,
  webhookUrl,
  fetchImpl,
} = {}) {
  const url = String(
    webhookUrl != null ? webhookUrl : process.env.OPS_ALERT_WEBHOOK_URL || "",
  ).trim();

  const [email, webhook] = await Promise.all([
    sendEmailAlert({title, lines, severity, smtpUser, smtpPassword, adminEmails}),
    postOpsWebhook(url, buildOpsAlertWebhook({title, lines, severity}), {fetchImpl}),
  ]);

  const delivered = email.sent === true || webhook.sent === true;
  // `sent` kept as a top-level convenience (= delivered on any channel).
  return {sent: delivered, delivered, channels: {email, webhook}};
}

module.exports = {
  parseAdminEmails,
  buildOpsAlertEmail,
  buildOpsAlertWebhook,
  postOpsWebhook,
  sendOpsAlert,
};
