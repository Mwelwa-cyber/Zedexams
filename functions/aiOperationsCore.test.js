/**
 * Node test for functions/aiOperationsCore.js — the pure decision logic
 * behind the shared AI-operation idempotency service. No firebase-admin /
 * firebase-functions dependency, so this runs under plain `node` with no
 * stubbing required (repo convention, same as googlePlayBillingCore.test.js).
 *
 * Run: node functions/aiOperationsCore.test.js
 */

const assert = require("node:assert");
const {
  isValidIdempotencyKey,
  computeInputFingerprint,
  decideReservationOutcome,
  classifyProviderError,
  retryBackoffMs,
  MAX_RETRIES,
} = require("./aiOperationsCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const UID = "teacher_123";
const OTHER_UID = "teacher_456";
const FP_A = computeInputFingerprint({grade: "G7", subject: "science", topic: "Cells"});
const FP_B = computeInputFingerprint({grade: "G7", subject: "science", topic: "Digestion"});

// ── isValidIdempotencyKey ───────────────────────────────────────────────────
ok("accepts a real UUID", isValidIdempotencyKey("3fa85f64-5717-4562-b3fc-2c963f66afa6"));
ok("accepts crypto.randomUUID() shape uppercase too", isValidIdempotencyKey("3FA85F64-5717-4562-B3FC-2C963F66AFA6"));
ok("rejects empty string", !isValidIdempotencyKey(""));
ok("rejects a non-uuid string", !isValidIdempotencyKey("not-a-uuid"));
ok("rejects a number", !isValidIdempotencyKey(42));
ok("rejects undefined", !isValidIdempotencyKey(undefined));
ok("rejects a client-guessable sequential id", !isValidIdempotencyKey("request-1"));

// ── computeInputFingerprint ─────────────────────────────────────────────────
ok("same fields → same fingerprint", computeInputFingerprint({a: 1, b: 2}) === computeInputFingerprint({a: 1, b: 2}));
ok("key order doesn't matter", computeInputFingerprint({a: 1, b: 2}) === computeInputFingerprint({b: 2, a: 1}));
ok("undefined fields don't matter", computeInputFingerprint({a: 1, b: undefined}) === computeInputFingerprint({a: 1}));
ok("different values → different fingerprint", computeInputFingerprint({a: 1}) !== computeInputFingerprint({a: 2}));
ok("nested objects are stable too",
    computeInputFingerprint({settings: {x: 1, y: 2}}) === computeInputFingerprint({settings: {y: 2, x: 1}}));
ok("arrays are order-sensitive (a settings array IS ordered)",
    computeInputFingerprint({types: ["mcq", "short"]}) !== computeInputFingerprint({types: ["short", "mcq"]}));
ok("fingerprint is a 64-char hex sha256", /^[0-9a-f]{64}$/.test(computeInputFingerprint({a: 1})));

// ── decideReservationOutcome: brand new key ────────────────────────────────
{
  const d = decideReservationOutcome({existing: null, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok("no existing record → create", d.action === "create");
}

// ── cross-user key reuse ────────────────────────────────────────────────────
{
  const existing = {userId: OTHER_UID, inputFingerprint: FP_A, status: "completed"};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok("a key belonging to another user is rejected regardless of status", d.action === "reject_cross_user");
}

// ── same key, different logical input (§8) ─────────────────────────────────
{
  const existing = {userId: UID, inputFingerprint: FP_A, status: "processing"};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_B, now: 1000});
  ok("same key + different fingerprint is rejected as reuse", d.action === "reject_fingerprint_mismatch");
}

// ── completed → resume with existing result, never re-call the provider ───
{
  const existing = {userId: UID, inputFingerprint: FP_A, status: "completed", resultDocumentId: "doc1"};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok("completed → return_completed (no provider call)", d.action === "return_completed");
}

// ── in-flight statuses → tell caller not to restart ────────────────────────
for (const status of ["reserved", "queued", "processing"]) {
  const existing = {userId: UID, inputFingerprint: FP_A, status};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok(`${status} → return_processing (not restarted)`, d.action === "return_processing");
}

// ── cancelled ────────────────────────────────────────────────────────────
{
  const existing = {userId: UID, inputFingerprint: FP_A, status: "cancelled"};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok("cancelled → return_cancelled", d.action === "return_cancelled");
}

// ── failed + non-retryable → terminal, no auto-retry ───────────────────────
{
  const existing = {userId: UID, inputFingerprint: FP_A, status: "failed", retryable: false, retryCount: 0};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok("non-retryable failure → return_terminal_failure", d.action === "return_terminal_failure");
}

// ── failed + retryable, backoff elapsed → retry ────────────────────────────
{
  const existing = {
    userId: UID, inputFingerprint: FP_A, status: "failed", retryable: true, retryCount: 0,
    updatedAt: 1000,
  };
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000 + retryBackoffMs(0) + 1});
  ok("retryable failure past backoff → retry", d.action === "retry");
}

// ── failed + retryable, backoff NOT elapsed → wait, don't hammer the provider
{
  const existing = {
    userId: UID, inputFingerprint: FP_A, status: "failed", retryable: true, retryCount: 0,
    updatedAt: 1000,
  };
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000 + 1});
  ok("retryable failure before backoff → retry_wait", d.action === "retry_wait");
  ok("retry_wait carries a concrete nextRetryAt", Number.isFinite(d.nextRetryAt));
}

// ── failed + retryable, exhausted retries → terminal ───────────────────────
{
  const existing = {
    userId: UID, inputFingerprint: FP_A, status: "failed", retryable: true, retryCount: MAX_RETRIES,
    updatedAt: 1000,
  };
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000 + 999999});
  ok("retries exhausted → return_terminal_failure even past backoff", d.action === "return_terminal_failure");
}

// ── unknown/corrupt status fails closed ─────────────────────────────────────
{
  const existing = {userId: UID, inputFingerprint: FP_A, status: "bogus-status"};
  const d = decideReservationOutcome({existing, uid: UID, inputFingerprint: FP_A, now: 1000});
  ok("unrecognised status fails closed (terminal, not create/retry)", d.action === "return_terminal_failure");
}

// ── classifyProviderError ───────────────────────────────────────────────────
{
  const timeout = classifyProviderError({code: "deadline-exceeded", message: "deadline exceeded"});
  ok("deadline-exceeded → PROVIDER_TIMEOUT, retryable", timeout.code === "PROVIDER_TIMEOUT" && timeout.retryable === true);

  const quota = classifyProviderError(
      Object.assign(new Error("You have used 3/3 assessments on the Free plan this month. Upgrade to continue."),
          {code: "failed-precondition"}),
  );
  ok("quota HttpsError → ALLOWANCE_EXCEEDED, not retryable", quota.code === "ALLOWANCE_EXCEEDED" && quota.retryable === false);

  const overloaded = classifyProviderError(new Error("upstream overloaded, 529"));
  ok("provider overload → PROVIDER_ERROR, retryable", overloaded.code === "PROVIDER_ERROR" && overloaded.retryable === true);

  const auth = classifyProviderError({code: "unauthenticated", message: "no session"});
  ok("unauthenticated → UNAUTHENTICATED, not retryable", auth.code === "UNAUTHENTICATED" && auth.retryable === false);

  const unknown = classifyProviderError(new Error("something exploded"));
  ok("unrecognised error → INTERNAL_ERROR, not retryable (fail closed)",
      unknown.code === "INTERNAL_ERROR" && unknown.retryable === false);

  const secretKey = "sk-ant-super-secret-do-not-leak-1234567890abcdef";
  const longMsg = classifyProviderError(new Error(`raw provider payload leaked: ${secretKey}`.repeat(10)));
  ok("long/raw provider messages are truncated, never fully echoed", longMsg.message.length <= 300);
}

console.log(`\n✓ ${passed} aiOperationsCore assertions passed.`);
