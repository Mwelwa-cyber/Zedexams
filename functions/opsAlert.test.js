/**
 * Unit tests for functions/opsAlert.js — the shared admin-alert helper.
 * Plain node: throws on first failed assertion. Exercises only the pure
 * helpers + the no-op skip paths (no SMTP / network needed).
 *
 *   node functions/opsAlert.test.js
 */
const assert = require("node:assert");
const {
  parseAdminEmails, buildOpsAlertEmail, buildOpsAlertWebhook, postOpsWebhook, sendOpsAlert,
} = require("./opsAlert");

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

  // ── buildOpsAlertWebhook ─────────────────────────────────────────
  const wh = buildOpsAlertWebhook({title: "Backup failed", lines: ["l1", "l2"], severity: "error"});
  assert.ok(wh.text.includes("Backup failed") && wh.text.includes("ERROR"), "webhook text has title + severity");
  assert.ok(wh.text.includes("l1") && wh.text.includes("l2"), "webhook text has lines");
  assert.ok(wh.text.startsWith("🔴"), "error severity → red marker");
  assert.ok(buildOpsAlertWebhook({title: "x"}).text.startsWith("🟠"), "warning default → orange marker");

  // ── postOpsWebhook (injected fetch) ──────────────────────────────
  assert.deepStrictEqual(
    await postOpsWebhook("", {text: "x"}),
    {sent: false, skipped: "webhook-unconfigured"}, "no url → skip");

  let posted = null;
  const okFetch = async (url, opts) => { posted = {url, opts}; return {ok: true, status: 200}; };
  assert.deepStrictEqual(await postOpsWebhook("https://hook", {text: "hi"}, {fetchImpl: okFetch}), {sent: true}, "2xx → sent");
  assert.strictEqual(posted.url, "https://hook", "posts to the url");
  assert.strictEqual(JSON.parse(posted.opts.body).text, "hi", "posts the JSON payload");

  const badFetch = async () => ({ok: false, status: 500});
  assert.deepStrictEqual(await postOpsWebhook("https://hook", {text: "x"}, {fetchImpl: badFetch}),
    {sent: false, skipped: "webhook-http-500"}, "non-2xx → skipped with status");

  const throwFetch = async () => { throw new Error("network down"); };
  assert.deepStrictEqual(await postOpsWebhook("https://hook", {text: "x"}, {fetchImpl: throwFetch}),
    {sent: false, skipped: "webhook-failed"}, "network error → skipped, never throws");

  // ── sendOpsAlert — two independent channels ──────────────────────
  // Neither channel configured → not delivered, both channels report why.
  const none = await sendOpsAlert({title: "x", smtpUser: "", smtpPassword: "", adminEmails: "a@x.com"});
  assert.strictEqual(none.delivered, false, "no channels → not delivered");
  assert.strictEqual(none.sent, false, "sent mirrors delivered");
  assert.strictEqual(none.channels.email.skipped, "smtp-unconfigured", "email skip reason preserved");
  assert.strictEqual(none.channels.webhook.skipped, "webhook-unconfigured", "webhook skip reason");

  const noRecipients = await sendOpsAlert({title: "x", smtpUser: "u@x.com", smtpPassword: "p", adminEmails: ""});
  assert.strictEqual(noRecipients.channels.email.skipped, "no-admin-emails", "no recipients → email skip");
  assert.strictEqual(noRecipients.delivered, false, "still not delivered without a webhook");

  // Webhook configured + email not → the alert STILL gets out (the OBS-004 win).
  const viaWebhook = await sendOpsAlert({
    title: "Critical", severity: "critical", smtpUser: "", smtpPassword: "",
    webhookUrl: "https://hook", fetchImpl: okFetch,
  });
  assert.strictEqual(viaWebhook.delivered, true, "webhook alone delivers a critical alert");
  assert.strictEqual(viaWebhook.channels.email.sent, false, "email channel independently reports skip");
  assert.strictEqual(viaWebhook.channels.webhook.sent, true, "webhook channel delivered");

  console.log("All opsAlert tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
