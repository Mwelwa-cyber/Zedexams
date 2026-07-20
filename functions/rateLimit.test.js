/**
 * Node test for rateLimit.js error construction (B3/OBS-005 error taxonomy).
 * Run: node functions/rateLimit.test.js
 *
 * rateLimit.js loads firebase-admin + firebase-functions at import time; stub
 * them (Module._load pattern, same as firestoreBackup.test.js) so the test runs
 * under a root-only `npm ci`. We only exercise the pure error-construction path.
 */

const assert = require("node:assert");
const Module = require("node:module");

// Capture-friendly HttpsError stub: records (code, message, details).
class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") {
    return {firestore: () => { throw new Error("not initialised in tests"); }};
  }
  if (request === "firebase-functions/v2/https") {
    return {HttpsError: FakeHttpsError};
  }
  return origLoad.call(this, request, ...rest);
};
const {rateLimitError, rateLimitMessage} = require("./rateLimit");
const {AI_ERROR_REASON} = require("./aiErrorReasons");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

console.log("rateLimit error taxonomy");

// A blocked burst result as enforceRateLimit would return it.
const result = {scope: "checkShortAnswer:u:abc123", limit: 30, retryAfterSec: 42, allowed: false};
const err = rateLimitError(result);

ok("code is resource-exhausted", err.code === "resource-exhausted");
ok("details.reason is the BURST reason (not a bare error)",
  err.details && err.details.reason === AI_ERROR_REASON.BURST_RATE_LIMIT);
ok("details.retryAfterSec threaded through", err.details.retryAfterSec === 42);
ok("details.action recovered from the scope prefix", err.details.action === "checkShortAnswer");
ok("message mentions the retry seconds", /42s/.test(rateLimitMessage(result)));

// Missing retryAfterSec → sane default, still a burst reason.
const err2 = rateLimitError({scope: "gen:quiz:u:x", allowed: false});
ok("default retryAfterSec = 60", err2.details.retryAfterSec === 60);
ok("action recovered even without retryAfterSec", err2.details.action === "gen");

console.log(`\nrateLimit error taxonomy: ${passed} checks passed`);
