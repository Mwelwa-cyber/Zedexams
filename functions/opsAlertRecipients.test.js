/**
 * Ops-alert recipient resolution — the decoupling of "where alerts go" from
 * "who may hold admin".
 *
 * Run: node functions/opsAlertRecipients.test.js
 */

const assert = require("node:assert");
const {
  parseEmailList,
  resolveOpsAlertRecipients,
} = require("./opsAlertRecipients");

// ── the parser ─────────────────────────────────────────────────────────────
assert.deepStrictEqual(
  parseEmailList(" A@x.com , b@X.com ,, a@x.com "),
  ["a@x.com", "b@x.com"],
  "trims, lowercases, drops blanks and de-duplicates",
);
assert.deepStrictEqual(parseEmailList(""), [], "empty → no recipients");
assert.deepStrictEqual(parseEmailList(undefined), [], "unset → no recipients");

// ── precedence ─────────────────────────────────────────────────────────────
assert.deepStrictEqual(
  resolveOpsAlertRecipients({
    opsAlertEmails: "ops@x.com",
    adminEmails: "admin@x.com",
    fallbackSender: "sender@x.com",
  }),
  {recipients: ["ops@x.com"], source: "ops-alert-emails"},
  "OPS_ALERT_EMAILS wins when set",
);

assert.deepStrictEqual(
  resolveOpsAlertRecipients({
    opsAlertEmails: "",
    adminEmails: "admin@x.com",
    fallbackSender: "sender@x.com",
  }),
  {recipients: ["admin@x.com"], source: "admin-emails"},
  "ADMIN_EMAILS still delivers alerts — reading a list grants nothing, and a " +
  "deployment that predates the split must not go quiet",
);

assert.deepStrictEqual(
  resolveOpsAlertRecipients({
    opsAlertEmails: "",
    adminEmails: "",
    fallbackSender: "sender@x.com",
  }),
  {recipients: ["sender@x.com"], source: "smtp-sender"},
  "with neither list configured the alert lands in the sending mailbox",
);

assert.deepStrictEqual(
  resolveOpsAlertRecipients({
    opsAlertEmails: "", adminEmails: "", fallbackSender: "",
  }),
  {recipients: [], source: "none"},
  "nothing configured is reported as 'none', not as a silent empty success",
);

// The source label is load-bearing for an operator debugging a missing alert:
// "went to the sender because nothing was configured" and "nobody to email"
// are different states and must not collapse into one.
assert.notStrictEqual(
  resolveOpsAlertRecipients({fallbackSender: "s@x.com", opsAlertEmails: "", adminEmails: ""}).source,
  resolveOpsAlertRecipients({fallbackSender: "", opsAlertEmails: "", adminEmails: ""}).source,
  "fallback-to-sender is distinguishable from no-recipients",
);

// ── env fallback ───────────────────────────────────────────────────────────
const savedOps = process.env.OPS_ALERT_EMAILS;
const savedAdmin = process.env.ADMIN_EMAILS;
try {
  process.env.OPS_ALERT_EMAILS = "env-ops@x.com";
  process.env.ADMIN_EMAILS = "env-admin@x.com";
  assert.deepStrictEqual(
    resolveOpsAlertRecipients().recipients,
    ["env-ops@x.com"],
    "reads OPS_ALERT_EMAILS from the environment when no override is passed",
  );

  delete process.env.OPS_ALERT_EMAILS;
  assert.deepStrictEqual(
    resolveOpsAlertRecipients().recipients,
    ["env-admin@x.com"],
    "falls back to ADMIN_EMAILS in the environment",
  );

  // An explicitly-passed empty string must OVERRIDE the environment rather
  // than fall through to it — otherwise a caller cannot express "no list".
  process.env.OPS_ALERT_EMAILS = "env-ops@x.com";
  assert.deepStrictEqual(
    resolveOpsAlertRecipients({opsAlertEmails: "", adminEmails: ""}).recipients,
    [],
    "an explicit empty override is honoured, not silently replaced by env",
  );
} finally {
  if (savedOps === undefined) delete process.env.OPS_ALERT_EMAILS;
  else process.env.OPS_ALERT_EMAILS = savedOps;
  if (savedAdmin === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = savedAdmin;
}

// ── multiple recipients survive intact ─────────────────────────────────────
assert.deepStrictEqual(
  resolveOpsAlertRecipients({opsAlertEmails: "a@x.com,b@x.com"}).recipients,
  ["a@x.com", "b@x.com"],
  "a comma-separated list reaches the transport as separate addresses",
);

console.log("All opsAlertRecipients tests passed.");
