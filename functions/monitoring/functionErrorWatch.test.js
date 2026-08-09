"use strict";

/**
 * The error watch's I/O behaviour, with Firestore and the alert channel faked.
 *
 * Run: node functions/monitoring/functionErrorWatch.test.js
 *
 * The most important test here is the BLIND one. A monitor that cannot read
 * its source and reports "0 errors" is the exact failure it was built to
 * correct — Sentry reported zero across a window Cloud Logging filled with 80,
 * and that zero was believed. So: a failed query must alert, and must never
 * settle into a clean-looking result.
 */
const assert = require("node:assert");
const {
  buildFilter,
  functionNameOf,
  messageOf,
  runFunctionErrorWatch,
  STATE_DOC,
} = require("./functionErrorWatch");

const T0 = 1_754_700_000_000;

/** Firestore double: one document, with optional read failure. */
function fakeDb({initial = null, failRead = false} = {}) {
  const store = {doc: initial};
  return {
    _store: store,
    doc(path) {
      assert.strictEqual(path, STATE_DOC);
      return {
        async get() {
          if (failRead) throw new Error("firestore down");
          return {exists: store.doc != null, data: () => store.doc};
        },
        async set(data) { store.doc = data; },
      };
    },
  };
}

const collectAlerts = () => {
  const sent = [];
  return {sent, fn: async (msg) => { sent.push(msg); }};
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── Filter + field extraction ───────────────────────────────────────────────

test("the filter covers BOTH function generations", () => {
  const f = buildFilter("2026-08-09T00:00:00Z");
  assert.ok(f.includes("cloud_run_revision"), "v2 functions run on Cloud Run");
  assert.ok(f.includes("cloud_function"), "v1 functions report as cloud_function");
  assert.ok(f.includes("severity>=ERROR"));
  assert.ok(f.includes('timestamp>="2026-08-09T00:00:00Z"'));
});

test("the function name is read from either generation's label", () => {
  assert.strictEqual(functionNameOf({resource: {labels: {service_name: "apitrackvisit"}}}), "apitrackvisit");
  assert.strictEqual(functionNameOf({resource: {labels: {function_name: "setUserRole"}}}), "setUserRole");
  assert.strictEqual(functionNameOf({}), "");
});

test("the message is read from whichever payload carries it", () => {
  assert.strictEqual(messageOf({textPayload: "Memory limit exceeded"}), "Memory limit exceeded");
  assert.strictEqual(messageOf({jsonPayload: {message: "boom"}}), "boom");
  assert.ok(messageOf({protoPayload: {status: {message: "denied"}}}).includes("denied"));
  assert.strictEqual(messageOf({}), "");
});

// ── The blind case ──────────────────────────────────────────────────────────

test("a FAILED log query alerts, and never reports a clean run", async () => {
  const {sent, fn} = collectAlerts();
  const result = await runFunctionErrorWatch({
    db: fakeDb(), now: T0, sendOpsAlert: fn,
    fetchErrorEntries: async () => { throw new Error("403 permission denied"); },
  });

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.blind, true);
  assert.strictEqual(sent.length, 1, "a blind monitor must say so");
  assert.strictEqual(sent[0].severity, "critical");
  assert.ok(sent[0].title.includes("BLIND"));
  assert.ok(sent[0].lines.join("\n").includes("403 permission denied"),
    "the reason must travel with the alert");
  assert.ok(sent[0].lines.join("\n").includes("UNKNOWN"),
    "health must be reported as unknown, not healthy");
});

test("a blind run does NOT overwrite the state doc", async () => {
  // Writing a fresh, empty state after a failed read would erase the streak
  // counters and silently reset every cooldown.
  const db = fakeDb({initial: {functions: {f: {consecutiveElevatedWindows: 1}}}});
  const {fn} = collectAlerts();
  await runFunctionErrorWatch({
    db, now: T0, sendOpsAlert: fn,
    fetchErrorEntries: async () => { throw new Error("nope"); },
  });
  assert.deepStrictEqual(db._store.doc, {functions: {f: {consecutiveElevatedWindows: 1}}});
});

// ── The normal cases ────────────────────────────────────────────────────────

test("a quiet window sends nothing", async () => {
  const {sent, fn} = collectAlerts();
  const result = await runFunctionErrorWatch({
    db: fakeDb(), now: T0, sendOpsAlert: fn, injectedEntries: [],
  });
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(result.alerted, false);
  assert.strictEqual(result.ok, true);
});

test("one memory kill alerts through the real path", async () => {
  const {sent, fn} = collectAlerts();
  const result = await runFunctionErrorWatch({
    db: fakeDb(), now: T0, sendOpsAlert: fn,
    injectedEntries: [{
      functionName: "apitrackvisit",
      message: "Memory limit of 128 MiB exceeded with 130 MiB used",
    }],
  });
  assert.strictEqual(result.alerted, true);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].severity, "critical");
  assert.ok(sent[0].lines.join("\n").includes("apitrackvisit"));
});

test("state is persisted so streaks and cooldowns survive between runs", async () => {
  const db = fakeDb();
  const {fn} = collectAlerts();
  await runFunctionErrorWatch({
    db, now: T0, sendOpsAlert: fn,
    injectedEntries: [{functionName: "f", message: "memory limit of 128 MiB exceeded"}],
  });
  assert.ok(db._store.doc.functions.f.lastOomAlertAt, "the cooldown must be recorded");
});

test("the alert carries the ops recipients and webhook, not just a title", async () => {
  process.env.OPS_ALERT_EMAILS = "ops@example.com";
  process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example.com/x";
  const {sent, fn} = collectAlerts();
  await runFunctionErrorWatch({
    db: fakeDb(), now: T0, sendOpsAlert: fn,
    injectedEntries: [{functionName: "f", message: "memory limit of 1 MiB exceeded"}],
  });
  assert.strictEqual(sent[0].opsAlertEmails, "ops@example.com");
  assert.strictEqual(sent[0].webhookUrl, "https://hooks.example.com/x");
  delete process.env.OPS_ALERT_EMAILS;
  delete process.env.OPS_ALERT_WEBHOOK_URL;
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`function error watch (handler): ${passed} passed`);
})();
