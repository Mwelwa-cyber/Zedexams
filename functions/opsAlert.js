/**
 * Shared ops-alert helper — one place to email ADMIN_EMAILS when a backend
 * failure needs a human, instead of every module re-implementing nodemailer.
 *
 * Re-uses the existing SMTP transport (mail.privateemail.com) and the
 * EMAIL_SMTP_USER / EMAIL_SMTP_PASSWORD secrets + ADMIN_EMAILS env var that
 * the daily-cost summary and Vigil monitor already use — no new infra.
 *
 * The pure helpers (parseAdminEmails, buildOpsAlertEmail) carry no
 * dependencies so they unit-test under plain `node` with no firebase /
 * nodemailer install. `sendOpsAlert` lazy-requires nodemailer only when it
 * actually has somewhere to send, keeping the pure-logic tests clean.
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

/**
 * Send an ops alert to ADMIN_EMAILS. Best-effort: returns a structured
 * result instead of throwing, so an alerting failure never breaks the path
 * that triggered it. No-ops (skipped) when SMTP creds or recipients are
 * absent — the caller should still have logged the underlying failure.
 *
 * @param {Object} args
 * @param {string} args.title
 * @param {string[]} [args.lines]
 * @param {string} [args.severity]
 * @param {string} [args.smtpUser]      EMAIL_SMTP_USER
 * @param {string} [args.smtpPassword]  EMAIL_SMTP_PASSWORD
 * @param {string} [args.adminEmails]   ADMIN_EMAILS (defaults to env)
 * @returns {Promise<{sent: boolean, skipped?: string, recipients?: number}>}
 */
async function sendOpsAlert({
  title,
  lines = [],
  severity = "warning",
  smtpUser,
  smtpPassword,
  adminEmails,
} = {}) {
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

module.exports = {parseAdminEmails, buildOpsAlertEmail, sendOpsAlert};
