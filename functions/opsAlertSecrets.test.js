/**
 * Unit tests for functions/opsAlertSecrets.js — the opt-in deploy binding for
 * the ops-alert webhook (Slack) channel. Plain node: throws on first failed
 * assertion. Nothing here touches firebase-functions; the injected
 * `defineSecret` proves the real one is never reached while the flag is off,
 * which is the whole point (an unbound secret must not break the deploy).
 *
 *   node functions/opsAlertSecrets.test.js
 */
const assert = require("node:assert");
const {
  OPS_ALERT_WEBHOOK_SECRET, OPS_ALERT_WEBHOOK_FLAG,
  isWebhookBindEnabled, opsAlertSecrets,
} = require("./opsAlertSecrets");

// A stand-in for firebase-functions' defineSecret: records every call.
function fakeDefine() {
  const calls = [];
  const define = (name) => { calls.push(name); return {__secret: name}; };
  return {define, calls};
}

const on = {[OPS_ALERT_WEBHOOK_FLAG]: "1"};

// ── isWebhookBindEnabled ───────────────────────────────────────────
assert.strictEqual(isWebhookBindEnabled({}), false, "unset flag → off");
assert.strictEqual(isWebhookBindEnabled(null), false, "null env → off, never throws");
assert.strictEqual(isWebhookBindEnabled(), isWebhookBindEnabled(process.env),
  "no argument falls back to process.env");
for (const raw of ["1", "true", "TRUE", " yes ", "on", "On"]) {
  assert.strictEqual(isWebhookBindEnabled({[OPS_ALERT_WEBHOOK_FLAG]: raw}), true,
    `${JSON.stringify(raw)} → on`);
}
for (const raw of ["", " ", "0", "false", "no", "off", "maybe", "bound"]) {
  assert.strictEqual(isWebhookBindEnabled({[OPS_ALERT_WEBHOOK_FLAG]: raw}), false,
    `${JSON.stringify(raw)} → off (only an affirmative binds)`);
}

// ── opsAlertSecrets — flag off ─────────────────────────────────────
{
  const {define, calls} = fakeDefine();
  const base = [{__secret: "EMAIL_SMTP_USER"}, {__secret: "EMAIL_SMTP_PASSWORD"}];
  const out = opsAlertSecrets(base, {env: {}, defineSecret: define});
  assert.deepStrictEqual(out, base, "flag off → base list unchanged");
  assert.notStrictEqual(out, base, "returns a copy, never the caller's array");
  assert.deepStrictEqual(calls, [],
    "flag off → defineSecret NEVER called, so a missing secret can't fail the deploy");
}

// ── opsAlertSecrets — flag on ──────────────────────────────────────
{
  const {define, calls} = fakeDefine();
  const base = [{__secret: "LENCO_API_KEY"}];
  const out = opsAlertSecrets(base, {env: on, defineSecret: define});
  assert.deepStrictEqual(calls, [OPS_ALERT_WEBHOOK_SECRET], "binds exactly the webhook secret");
  assert.strictEqual(out.length, 2, "appended, not replaced");
  assert.strictEqual(out[0], base[0], "existing secret params pass through by reference");
  assert.deepStrictEqual(out[1], {__secret: "OPS_ALERT_WEBHOOK_URL"}, "webhook secret is last");
  assert.deepStrictEqual(base, [{__secret: "LENCO_API_KEY"}], "caller's array is not mutated");
}

// ── shape guards ───────────────────────────────────────────────────
{
  const {define} = fakeDefine();
  assert.deepStrictEqual(opsAlertSecrets(undefined, {env: {}, defineSecret: define}), [],
    "no base → empty list");
  assert.deepStrictEqual(opsAlertSecrets(null, {env: {}, defineSecret: define}), [],
    "null base → empty list");
  assert.deepStrictEqual(opsAlertSecrets("nope", {env: {}, defineSecret: define}), [],
    "non-array base → empty list, never a string spread");
  assert.strictEqual(opsAlertSecrets([], {env: on, defineSecret: define}).length, 1,
    "empty base still gets the webhook secret when bound");
}

// The secret name is the one sendOpsAlert reads from process.env — if these
// ever diverge the channel is bound but silently unconfigured.
assert.strictEqual(OPS_ALERT_WEBHOOK_SECRET, "OPS_ALERT_WEBHOOK_URL",
  "secret name matches opsAlert.js's process.env lookup");
{
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "opsAlert.js"), "utf8");
  assert.ok(src.includes(`process.env.${OPS_ALERT_WEBHOOK_SECRET}`),
    "opsAlert.js still reads the bound secret from process.env under this exact name");
}

console.log("All opsAlertSecrets tests passed.");
