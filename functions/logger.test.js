/**
 * Node tests for the structured Cloud Functions logger (OBS-003).
 */

const assert = require("assert");
const { createLogger, newRequestId, requestIdFromReq } = require("./logger");

// Capture emitted lines instead of hitting the console.
function capturingLogger(module, fields) {
  const lines = [];
  const log = createLogger(module, fields, (severity, line) => lines.push({ severity, obj: JSON.parse(line) }));
  return { log, lines };
}

let passed = 0;
function ok(name, fn) { fn(); console.log(`  ✓ ${name}`); passed++; }

console.log("logger");

ok("emits a JSON entry with severity, message and module", () => {
  const { log, lines } = capturingLogger("mymod");
  log.info("hello", { foo: 1 });
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(lines[0].obj, { severity: "INFO", message: "hello", module: "mymod", foo: 1 });
});

ok("maps levels to Cloud Logging severities", () => {
  const { log, lines } = capturingLogger("m");
  log.debug("d"); log.info("i"); log.warn("w"); log.error("e");
  assert.deepStrictEqual(lines.map((l) => l.severity), ["DEBUG", "INFO", "WARNING", "ERROR"]);
});

ok("child() binds correlation fields onto every line", () => {
  const { log, lines } = capturingLogger("m", { app: "z" });
  const child = log.child({ rid: "abc123" });
  child.warn("oops", { category: "x" });
  assert.strictEqual(lines[0].obj.rid, "abc123");
  assert.strictEqual(lines[0].obj.app, "z");
  assert.strictEqual(lines[0].obj.category, "x");
  assert.strictEqual(lines[0].obj.severity, "WARNING");
});

ok("per-call fields override base fields", () => {
  const { log, lines } = capturingLogger("m", { uid: "base" });
  log.info("x", { uid: "call" });
  assert.strictEqual(lines[0].obj.uid, "call");
});

ok("reserved keys (message/severity/module) are never clobbered by fields", () => {
  const { log, lines } = capturingLogger("mymod");
  // A caller that puts the exception text under `message` must NOT overwrite the
  // event name — filters/alerts match on it. Use errorMessage for the detail.
  log.error("chat_auth_error", { message: "boom", severity: "DEBUG", module: "evil", errorMessage: "boom" });
  assert.strictEqual(lines[0].obj.message, "chat_auth_error");
  assert.strictEqual(lines[0].obj.severity, "ERROR");
  assert.strictEqual(lines[0].obj.module, "mymod");
  assert.strictEqual(lines[0].obj.errorMessage, "boom");
});

ok("a throwing sink never propagates into the caller", () => {
  const log = createLogger("m", {}, () => { throw new Error("sink down"); });
  assert.doesNotThrow(() => log.error("still fine"));
});

ok("newRequestId returns distinct ids", () => {
  assert.notStrictEqual(newRequestId(), newRequestId());
});

ok("requestIdFromReq reads x-request-id via req.get()", () => {
  const req = { get: (h) => (h === "x-request-id" ? "client-rid-1" : null) };
  assert.strictEqual(requestIdFromReq(req), "client-rid-1");
});

ok("requestIdFromReq reads the header map when req.get is absent", () => {
  assert.strictEqual(requestIdFromReq({ headers: { "x-request-id": "hdr-rid" } }), "hdr-rid");
});

ok("requestIdFromReq mints one when the header is missing", () => {
  const id = requestIdFromReq({ get: () => null });
  assert.ok(id && id.length >= 10);
});

ok("requestIdFromReq strips unsafe chars and bounds the length", () => {
  const req = { get: () => "  ../../etc/passwd\n<script>" + "x".repeat(200) };
  const id = requestIdFromReq(req);
  assert.ok(id.length <= 64);
  assert.ok(/^[A-Za-z0-9._-]+$/.test(id), id);
});

console.log(`All logger tests passed (${passed}).`);
