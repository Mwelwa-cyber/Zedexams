/**
 * Node tests for the reCAPTCHA Enterprise assessment core (pure helpers).
 * Run: node functions/recaptchaAssessment.test.js
 */

const assert = require("node:assert");
const {
  ANDROID_SITE_KEY,
  DEFAULT_THRESHOLDS,
  resolveProjectId,
  assessmentUrl,
  buildAssessmentRequest,
  isAssessableToken,
  interpretAssessment,
} = require("./recaptchaAssessmentCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("recaptchaAssessmentCore");

// ── constants / config ───────────────────────────────────────────────────
ok("ships the Android site key", typeof ANDROID_SITE_KEY === "string" && ANDROID_SITE_KEY.length > 20);
ok("block threshold below challenge", DEFAULT_THRESHOLDS.block < DEFAULT_THRESHOLDS.challenge);
ok("resolveProjectId falls back to examsprepzambia when no env set", (() => {
  const saved = {
    a: process.env.RECAPTCHA_PROJECT_ID,
    b: process.env.GCLOUD_PROJECT,
    c: process.env.GOOGLE_CLOUD_PROJECT,
  };
  delete process.env.RECAPTCHA_PROJECT_ID;
  delete process.env.GCLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  const got = resolveProjectId();
  if (saved.a !== undefined) process.env.RECAPTCHA_PROJECT_ID = saved.a;
  if (saved.b !== undefined) process.env.GCLOUD_PROJECT = saved.b;
  if (saved.c !== undefined) process.env.GOOGLE_CLOUD_PROJECT = saved.c;
  return got === "examsprepzambia";
})());
ok("assessmentUrl embeds the project id", assessmentUrl("myproj") ===
  "https://recaptchaenterprise.googleapis.com/v1/projects/myproj/assessments");

// ── buildAssessmentRequest ────────────────────────────────────────────────
const req = buildAssessmentRequest({token: "tok", action: "login", siteKey: "KEY"});
ok("request nests the event", req.event && req.event.token === "tok" && req.event.siteKey === "KEY");
ok("request carries expectedAction when action given", req.event.expectedAction === "login");
ok("request omits expectedAction when no action",
  buildAssessmentRequest({token: "t", siteKey: "K"}).event.expectedAction === undefined);

// ── isAssessableToken ─────────────────────────────────────────────────────
ok("empty token not assessable", isAssessableToken("") === false);
ok("short token not assessable", isAssessableToken("abc") === false);
ok("non-string not assessable", isAssessableToken(null) === false && isAssessableToken(undefined) === false);
ok("long token is assessable", isAssessableToken("x".repeat(40)) === true);

// ── interpretAssessment: happy paths ──────────────────────────────────────
const high = interpretAssessment(
  {tokenProperties: {valid: true, action: "login"}, riskAnalysis: {score: 0.9, reasons: []}},
  {expectedAction: "login"});
ok("high score → allow", high.verdict === "allow" && high.score === 0.9 && high.valid === true);

const mid = interpretAssessment(
  {tokenProperties: {valid: true, action: "login"}, riskAnalysis: {score: 0.4}},
  {expectedAction: "login"});
ok("mid score → challenge", mid.verdict === "challenge");

const low = interpretAssessment(
  {tokenProperties: {valid: true, action: "login"}, riskAnalysis: {score: 0.1, reasons: ["AUTOMATION"]}},
  {expectedAction: "login"});
ok("low score → block", low.verdict === "block" && low.reasons[0] === "AUTOMATION");

// Boundary: exactly at a threshold rounds up into the safer bucket.
ok("score == block threshold is NOT blocked",
  interpretAssessment({tokenProperties: {valid: true}, riskAnalysis: {score: DEFAULT_THRESHOLDS.block}}).verdict !== "block");
ok("score == challenge threshold → allow",
  interpretAssessment({tokenProperties: {valid: true}, riskAnalysis: {score: DEFAULT_THRESHOLDS.challenge}}).verdict === "allow");

// ── interpretAssessment: fail-open cases ──────────────────────────────────
const invalid = interpretAssessment(
  {tokenProperties: {valid: false, invalidReason: "EXPIRED"}, riskAnalysis: {}});
ok("invalid token → skip, not block", invalid.verdict === "skip" && invalid.valid === false);
ok("invalid token surfaces invalidReason", invalid.invalidReason === "EXPIRED");

const mismatch = interpretAssessment(
  {tokenProperties: {valid: true, action: "signup"}, riskAnalysis: {score: 0.9}},
  {expectedAction: "login"});
ok("action mismatch → skip", mismatch.verdict === "skip" && mismatch.actionMismatch === true);

const noScore = interpretAssessment({tokenProperties: {valid: true, action: "login"}, riskAnalysis: {}});
ok("valid token but no score → skip", noScore.verdict === "skip" && noScore.score === null);

ok("empty/garbage assessment → skip (never crashes)",
  interpretAssessment({}).verdict === "skip" && interpretAssessment(null).verdict === "skip");

console.log(`\n${passed} passed`);
