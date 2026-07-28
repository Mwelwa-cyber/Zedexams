/**
 * Who receives an ops alert — resolved in ONE place, so "where do alerts go"
 * is a question with a single answer rather than six copies of a split-on-comma.
 *
 * WHY THIS EXISTS (the decoupling — #1993):
 * `ADMIN_EMAILS` used to be the only recipient list, and it does double duty:
 * `resolveInitialUserRole` (functions/index.js) also treats every address in it
 * as an account that is born an administrator. That made "tell me when a backup
 * fails" and "this address may hold admin" the SAME switch — so the only way to
 * get an alert delivered was to widen an authorization allowlist, and the
 * allowlist lives in a committed file.
 *
 * `OPS_ALERT_EMAILS` is the recipient list and grants nothing. `ADMIN_EMAILS`
 * keeps its authorization meaning and is still ACCEPTED here as a fallback, so
 * an environment that already set it keeps receiving alerts — reading a list
 * cannot grant anything, and it is only the other direction that was dangerous.
 *
 * Precedence, first non-empty wins:
 *   1. OPS_ALERT_EMAILS  — the dedicated recipient list
 *   2. ADMIN_EMAILS      — back-compat for deployments that predate the split
 *   3. the SMTP sender   — so an alert lands in the sending mailbox rather than
 *                          being dropped; callers pass this, because only they
 *                          know which sender their transport resolved to
 *
 * Pure and dependency-free: unit-tests under plain `node` with no firebase or
 * nodemailer install.
 */

/**
 * Split a comma-separated address list into a clean, de-duplicated array.
 * @param {string} raw
 * @returns {string[]}
 */
function parseEmailList(raw) {
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
 * Resolve the recipient list for an ops alert.
 *
 * `source` is returned alongside the addresses because a caller that logs
 * "alert skipped, no recipients" and a caller that logs "alert went to the
 * SMTP sender because nothing was configured" are reporting different
 * operational states, and the difference is exactly what an operator needs
 * when they are working out why an alert never arrived.
 *
 * @param {Object} [args]
 * @param {string} [args.opsAlertEmails]  OPS_ALERT_EMAILS (defaults to env)
 * @param {string} [args.adminEmails]     ADMIN_EMAILS (defaults to env)
 * @param {string} [args.fallbackSender]  the resolved SMTP sender, if any
 * @returns {{recipients: string[],
 *   source: "ops-alert-emails"|"admin-emails"|"smtp-sender"|"none"}}
 */
function resolveOpsAlertRecipients({
  opsAlertEmails,
  adminEmails,
  fallbackSender,
} = {}) {
  const ops = parseEmailList(
    opsAlertEmails != null ? opsAlertEmails : process.env.OPS_ALERT_EMAILS,
  );
  if (ops.length) return {recipients: ops, source: "ops-alert-emails"};

  const admins = parseEmailList(
    adminEmails != null ? adminEmails : process.env.ADMIN_EMAILS,
  );
  if (admins.length) return {recipients: admins, source: "admin-emails"};

  const sender = parseEmailList(fallbackSender);
  if (sender.length) return {recipients: sender, source: "smtp-sender"};

  return {recipients: [], source: "none"};
}

module.exports = {
  parseEmailList,
  resolveOpsAlertRecipients,
};
