/**
 * Node test for the CORS origin allow-list.
 * Run: node functions/cors.test.js
 */

const assert = require("node:assert");
const {ALLOWED_ORIGINS, isAllowedOrigin, applyCors} = require("./cors");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("cors");

// ── isAllowedOrigin: every confirmed origin passes ───────────────────────
for (const o of ALLOWED_ORIGINS) {
  ok(`allows ${o}`, isAllowedOrigin(o) === true);
}
ok("allows a preview channel",
  isAllowedOrigin("https://examsprepzambia--pr-42-ab12cd.web.app") === true);

// ── Denied / spoof attempts ──────────────────────────────────────────────
ok("denies wildcard literal", isAllowedOrigin("*") === false);
ok("denies null/undefined", isAllowedOrigin(undefined) === false && isAllowedOrigin(null) === false);
ok("denies empty string", isAllowedOrigin("") === false);
ok("denies suffix-spoof zedexams.com.evil.com",
  isAllowedOrigin("https://zedexams.com.evil.com") === false);
ok("denies prefix-spoof evilzedexams.com",
  isAllowedOrigin("https://evilzedexams.com") === false);
ok("denies http (non-TLS) prod origin",
  isAllowedOrigin("http://zedexams.com") === false);
ok("denies fake preview host",
  isAllowedOrigin("https://examsprepzambia--x.web.app.evil.com") === false);
ok("denies bare web.app",
  isAllowedOrigin("https://examsprepzambia.web.app.evil.com") === false);
ok("denies other localhost port",
  isAllowedOrigin("http://localhost:3000") === false);

// ── applyCors behaviour with a fake req/res ──────────────────────────────
function fakeRes() {
  const headers = {};
  return {headers, set(k, v) { headers[k] = v; }};
}
function fakeReq(origin) {
  return {get: (h) => (h.toLowerCase() === "origin" ? origin : undefined)};
}

let res = fakeRes();
applyCors(fakeReq("https://zedexams.com"), res);
ok("allowed origin is echoed (never *)",
  res.headers["Access-Control-Allow-Origin"] === "https://zedexams.com");
ok("Vary: Origin always set", res.headers["Vary"] === "Origin");
ok("default headers include AppCheck",
  /X-Firebase-AppCheck/.test(res.headers["Access-Control-Allow-Headers"]));

res = fakeRes();
applyCors(fakeReq("https://evil.com"), res);
ok("disallowed origin → no ACAO",
  res.headers["Access-Control-Allow-Origin"] === undefined);
ok("disallowed origin still sets Vary", res.headers["Vary"] === "Origin");

res = fakeRes();
applyCors(fakeReq(undefined), res);
ok("no Origin (native/curl) → no ACAO, request still proceeds",
  res.headers["Access-Control-Allow-Origin"] === undefined);

console.log(`\n─── ${passed} assertions · all passed ───`);
