/**
 * Unit tests for functions/opsAlertTestCore.js — the pure decisions behind the
 * admin "Send test alert" panel. Plain node: throws on first failed assertion.
 *
 *   node functions/opsAlertTestCore.test.js
 */
const assert = require("node:assert");
const {
  TEST_ALERT_TITLE, MAX_NOTE_LENGTH,
  sanitizeNote, buildTestAlert, describeChannel, summarizeAlertResult,
} = require("./opsAlertTestCore");
const {buildOpsAlertWebhook, buildOpsAlertEmail} = require("./opsAlert");

// ── sanitizeNote ───────────────────────────────────────────────────
assert.strictEqual(sanitizeNote(null), "", "null → empty");
assert.strictEqual(sanitizeNote(undefined), "", "undefined → empty");
assert.strictEqual(sanitizeNote("  spaced  out  "), "spaced out", "collapses + trims");
// A note reaches a channel other people read, so a newline must not be able to
// forge extra lines in the message.
assert.strictEqual(
  sanitizeNote("first" + String.fromCharCode(10) + "🔴 CRITICAL: database down"),
  "first 🔴 CRITICAL: database down",
  "newline becomes a space — cannot forge a second line",
);
assert.ok(!sanitizeNote("a" + String.fromCharCode(13) + "b").includes(String.fromCharCode(13)),
  "carriage return stripped");
assert.strictEqual(sanitizeNote("x".repeat(500)).length, MAX_NOTE_LENGTH, "length capped");
assert.strictEqual(sanitizeNote(12345), "12345", "non-string coerced");

// ── buildTestAlert ─────────────────────────────────────────────────
{
  const a = buildTestAlert({actorEmail: "boss@zedexams.com", nowIso: "2026-01-02T03:04:05Z"});
  assert.strictEqual(a.title, TEST_ALERT_TITLE, "uses the test title");
  // The channel this lands in is the one people trust for real incidents, so a
  // test must never wear a red marker or an alarming title.
  assert.strictEqual(a.severity, "info", "severity is info, never critical");
  assert.ok(/nothing is wrong/i.test(a.title), "title says nothing is wrong");
  assert.ok(a.lines.some((l) => l.includes("boss@zedexams.com")), "names the requester");
  assert.ok(a.lines.some((l) => l.includes("2026-01-02T03:04:05Z")), "carries the timestamp");
  assert.ok(a.lines.some((l) => /no action is needed/i.test(l)), "tells the reader to relax");

  // Rendered through the real builders, the test alert must carry the calm
  // marker — this is the thing an operator actually sees.
  assert.ok(buildOpsAlertWebhook(a).text.startsWith("🔵"), "renders with the blue info marker");
  assert.ok(buildOpsAlertEmail(a).subject.includes("INFO"), "email subject says INFO");
}
{
  const noEmail = buildTestAlert({actorUid: "uid-123"});
  assert.ok(noEmail.lines.some((l) => l.includes("uid-123")), "falls back to uid");
  const anon = buildTestAlert();
  assert.ok(anon.lines.some((l) => l.includes("an admin")), "falls back to 'an admin'");
  assert.ok(!anon.lines.some((l) => l.startsWith("Sent at:")), "no timestamp line without nowIso");
  assert.ok(!anon.lines.some((l) => l.startsWith("Note:")), "no note line without a note");
}
{
  const withNote = buildTestAlert({note: "after rotating the webhook"});
  assert.ok(withNote.lines.some((l) => l === "Note: after rotating the webhook"), "echoes the note");
}

// ── describeChannel ────────────────────────────────────────────────
assert.deepStrictEqual(describeChannel({sent: true}), {status: "sent", reason: null, detail: null},
  "sent → sent, nothing to explain");

{
  const unconfigured = describeChannel({sent: false, skipped: "webhook-unconfigured"});
  assert.strictEqual(unconfigured.status, "not-configured", "unconfigured is not a failure");
  assert.ok(/OPS_ALERT_WEBHOOK_BOUND/.test(unconfigured.detail),
    "explanation names the flag the operator must set");

  const noEmails = describeChannel({sent: false, skipped: "no-admin-emails"});
  assert.strictEqual(noEmails.status, "not-configured", "empty ADMIN_EMAILS is configuration");

  const http404 = describeChannel({sent: false, skipped: "webhook-http-404"});
  assert.strictEqual(http404.status, "failed", "an HTTP error is a failure");
  assert.ok(http404.detail.includes("404"), "explanation quotes the status code");

  const smtp = describeChannel({sent: false, skipped: "send-failed"});
  assert.strictEqual(smtp.status, "failed", "SMTP rejection is a failure");
}

// An unrecognised reason must be reported as unrecognised — never silently
// folded into a known cause, and never shown as success.
{
  const weird = describeChannel({sent: false, skipped: "quantum-tunnelling"});
  assert.strictEqual(weird.status, "failed", "unknown reason is not a pass");
  assert.ok(weird.detail.includes("quantum-tunnelling"), "surfaces the raw reason verbatim");
}
for (const bad of [null, undefined, "nope", 7]) {
  assert.strictEqual(describeChannel(bad).status, "unknown", `${JSON.stringify(bad)} → unknown`);
}
assert.strictEqual(describeChannel({sent: false}).status, "unknown",
  "no reason and no success → unknown, not a guess");

// ── summarizeAlertResult ───────────────────────────────────────────
{
  const both = summarizeAlertResult({
    delivered: true, channels: {email: {sent: true}, webhook: {sent: true}},
  });
  assert.strictEqual(both.verdict, "both", "two channels → both");
  assert.strictEqual(both.delivered, true);
}
{
  // The OBS-004 case: email is down, the chat channel alone got it out. The
  // alert arrived, so this is not a failure — but the redundancy is gone, and
  // the verdict has to say so rather than reading as a clean pass.
  const one = summarizeAlertResult({
    delivered: true,
    channels: {email: {sent: false, skipped: "smtp-unconfigured"}, webhook: {sent: true}},
  });
  assert.strictEqual(one.verdict, "one", "single channel → one, distinct from both");
  assert.strictEqual(one.delivered, true, "still delivered");
  assert.strictEqual(one.slack.status, "sent");
  assert.strictEqual(one.email.status, "not-configured");
}
{
  const none = summarizeAlertResult({
    delivered: false,
    channels: {
      email: {sent: false, skipped: "smtp-unconfigured"},
      webhook: {sent: false, skipped: "webhook-unconfigured"},
    },
  });
  assert.strictEqual(none.verdict, "none", "nothing sent → none");
  assert.strictEqual(none.delivered, false, "nothing delivered");
}
{
  // A malformed result must not read as a success.
  const empty = summarizeAlertResult(undefined);
  assert.strictEqual(empty.verdict, "none");
  assert.strictEqual(empty.delivered, false);
  assert.strictEqual(empty.slack.status, "unknown");
  assert.strictEqual(empty.email.status, "unknown");
}
{
  // `delivered` is trusted from a channel that reported sent even if the
  // top-level flag disagrees — the per-channel result is the primary evidence.
  const odd = summarizeAlertResult({delivered: false, channels: {webhook: {sent: true}}});
  assert.strictEqual(odd.delivered, true, "a sent channel means delivered");
}

console.log("All opsAlertTestCore tests passed.");
