/**
 * Node test for the canonical AI error reason codes.
 * Run: node functions/aiErrorReasons.test.js
 */
const assert = require("node:assert");
const {AI_ERROR_REASON} = require("./aiErrorReasons");

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

console.log("aiErrorReasons");
ok("burst reason string", AI_ERROR_REASON.BURST_RATE_LIMIT === "burst_rate_limit");
ok("daily reason string", AI_ERROR_REASON.DAILY_QUOTA_EXHAUSTED === "daily_quota_exhausted");
ok("monthly reason string", AI_ERROR_REASON.MONTHLY_BUDGET_EXHAUSTED === "monthly_budget_exhausted");
ok("concurrency reason string", AI_ERROR_REASON.CONCURRENCY_LIMIT === "concurrency_limit");
ok("provider reason string", AI_ERROR_REASON.PROVIDER_UNAVAILABLE === "provider_unavailable");
ok("frozen (immutable)", Object.isFrozen(AI_ERROR_REASON));
console.log(`aiErrorReasons: ${passed} checks passed`);
