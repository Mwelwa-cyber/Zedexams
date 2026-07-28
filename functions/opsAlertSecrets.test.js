/**
 * Unit tests for functions/opsAlertSecrets.js — the binding of the ops-alert
 * webhook (Slack) secret. Plain node: throws on first failed assertion.
 *
 * The regression these guard is not hypothetical. The first version gated the
 * binding on a flag in functions/.env.<project>, read via process.env at module
 * load. `firebase deploy` analyses the source in a subprocess that receives only
 * FIREBASE_CONFIG / GCLOUD_PROJECT / GOOGLE_CLOUD_QUOTA_PROJECT, so the flag was
 * always undefined at deploy time: no function bound the secret, the deploy
 * passed (an unreferenced secret is never validated), and every ops alert went
 * out by email only until the admin test panel reported the empty URL.
 *
 *   node functions/opsAlertSecrets.test.js
 */
const assert = require("node:assert");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {OPS_ALERT_WEBHOOK_SECRET, opsAlertSecrets} = require("./opsAlertSecrets");

// A stand-in for firebase-functions' defineSecret: records every call.
function fakeDefine() {
  const calls = [];
  const define = (name) => { calls.push(name); return {__secret: name}; };
  return {define, calls};
}

// ── the binding is unconditional ───────────────────────────────────
{
  const {define, calls} = fakeDefine();
  const base = [{__secret: "EMAIL_SMTP_USER"}, {__secret: "EMAIL_SMTP_PASSWORD"}];
  const out = opsAlertSecrets(base, {defineSecret: define});
  assert.deepStrictEqual(calls, [OPS_ALERT_WEBHOOK_SECRET], "binds exactly the webhook secret");
  assert.strictEqual(out.length, 3, "appended, not replaced");
  assert.strictEqual(out[0], base[0], "existing secret params pass through by reference");
  assert.deepStrictEqual(out[2], {__secret: "OPS_ALERT_WEBHOOK_URL"}, "webhook secret is last");
  assert.strictEqual(base.length, 2, "caller's array is not mutated");
}

// No environment variable may switch this off — that is the whole bug. Deploy
// analysis cannot see functions/.env.<project>, so a binding that depends on it
// silently does not happen.
for (const value of [undefined, "", "0", "false", "1", "true"]) {
  const {define, calls} = fakeDefine();
  const saved = process.env.OPS_ALERT_WEBHOOK_BOUND;
  if (value === undefined) delete process.env.OPS_ALERT_WEBHOOK_BOUND;
  else process.env.OPS_ALERT_WEBHOOK_BOUND = value;
  try {
    assert.deepStrictEqual(
      opsAlertSecrets([], {defineSecret: define}),
      [{__secret: "OPS_ALERT_WEBHOOK_URL"}],
      `binds with OPS_ALERT_WEBHOOK_BOUND=${JSON.stringify(value)} — no env gate`,
    );
    assert.strictEqual(calls.length, 1, "defineSecret called exactly once");
  } finally {
    if (saved === undefined) delete process.env.OPS_ALERT_WEBHOOK_BOUND;
    else process.env.OPS_ALERT_WEBHOOK_BOUND = saved;
  }
}

// Source guard: a `process.env` read is how the bug got in, and it is invisible
// at runtime (the deployed function's env DOES have the file's values — only the
// deploy-time analysis does not).
{
  const src = readFileSync(join(__dirname, "opsAlertSecrets.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/process\.env/.test(code),
    "opsAlertSecrets.js must not read process.env — deploy-time analysis cannot see " +
    "functions/.env.<project>, so an env-gated binding silently never happens",
  );
}

// ── shape guards ───────────────────────────────────────────────────
{
  const {define} = fakeDefine();
  assert.strictEqual(opsAlertSecrets(undefined, {defineSecret: define}).length, 1,
    "no base → just the webhook secret");
  assert.strictEqual(opsAlertSecrets(null, {defineSecret: define}).length, 1,
    "null base → just the webhook secret");
  assert.deepStrictEqual(opsAlertSecrets("nope", {defineSecret: define}),
    [{__secret: "OPS_ALERT_WEBHOOK_URL"}],
    "non-array base → ignored, never a string spread");
}

// The secret name is the one sendOpsAlert reads from process.env AT RUNTIME (a
// bound secret is mounted as an env var). If these diverge the secret is bound
// but the channel is silently unconfigured.
assert.strictEqual(OPS_ALERT_WEBHOOK_SECRET, "OPS_ALERT_WEBHOOK_URL", "secret name is stable");
{
  const src = readFileSync(join(__dirname, "opsAlert.js"), "utf8");
  assert.ok(src.includes(`process.env.${OPS_ALERT_WEBHOOK_SECRET}`),
    "opsAlert.js still reads the bound secret from process.env under this exact name");
}

// Every function that raises an ops alert must route its secrets through this
// helper — one that binds the SMTP pair directly gets no chat channel, and the
// only symptom is a quieter alert nobody notices.
{
  const CALLERS = [
    "index.js", "firestoreBackup.js", "storageBackup.js",
    "rateLimitHealth.js", "opsHeartbeat.js", "opsAlertTest.js",
  ];
  for (const file of CALLERS) {
    const src = readFileSync(join(__dirname, file), "utf8");
    assert.ok(/opsAlertSecrets/.test(src), `${file} must bind through opsAlertSecrets`);
  }
}

console.log("All opsAlertSecrets tests passed.");
