/**
 * Unit tests for functions/opsAlert.js — the shared admin-alert helper.
 * Plain node: throws on first failed assertion. Exercises only the pure
 * helpers + the no-op skip paths (no SMTP / network needed).
 *
 *   node functions/opsAlert.test.js
 */
const assert = require("node:assert");
const {parseAdminEmails, buildOpsAlertEmail, sendOpsAlert} = require("./opsAlert");

(async () => {
  // ── parseAdminEmails ─────────────────────────────────────────────
  assert.deepStrictEqual(parseAdminEmails(""), [], "empty → []");
  assert.deepStrictEqual(parseAdminEmails(null), [], "null → []");
  assert.deepStrictEqual(
    parseAdminEmails("A@x.com, b@x.com"),
    ["a@x.com", "b@x.com"],
    "trims + lowercases",
  );
  assert.deepStrictEqual(
    parseAdminEmails("a@x.com, a@x.com, ,b@x.com"),
    ["a@x.com", "b@x.com"],
    "dedupes + drops empties",
  );

  // ── buildOpsAlertEmail ───────────────────────────────────────────
  const email = buildOpsAlertEmail({
    title: "Agent broke",
    lines: ["line one", "line two"],
    severity: "critical",
  });
  assert.strictEqual(
    email.subject,
    "[ZedExams ops] CRITICAL: Agent broke",
    "subject carries uppercased severity + title",
  );
  assert.ok(email.text.includes("line one") && email.text.includes("line two"), "body has lines");
  assert.ok(email.text.includes("Severity: CRITICAL"), "body has severity");

  const dflt = buildOpsAlertEmail({title: "x"});
  assert.ok(dflt.subject.includes("WARNING"), "severity defaults to warning");

  // ── sendOpsAlert skip paths ──────────────────────────────────────
  const noCreds = await sendOpsAlert({
    title: "x", smtpUser: "", smtpPassword: "", adminEmails: "a@x.com",
  });
  assert.deepStrictEqual(noCreds, {sent: false, skipped: "smtp-unconfigured"}, "no creds → skip");

  const noRecipients = await sendOpsAlert({
    title: "x", smtpUser: "u@x.com", smtpPassword: "p", adminEmails: "",
  });
  assert.deepStrictEqual(noRecipients, {sent: false, skipped: "no-admin-emails"}, "no recipients → skip");

  console.log("All opsAlert tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
