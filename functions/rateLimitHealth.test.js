/**
 * Node test for the rate-limiter health canary (OBS-005 / OBS-004).
 * Run: node functions/rateLimitHealth.test.js
 *
 * Covers the pure core (classify + edge-triggered alert) and drives
 * runRateLimitHealthCheck through healthy / degraded-onset / still-degraded /
 * recovery / disabled with an injected probe + fake Firestore + alert, pinning
 * that a degraded limiter alerts ONCE at onset (not every hour) and that the
 * intentional kill-switch never alerts.
 */

const assert = require("node:assert");
const Module = require("node:module");

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-functions/v2/scheduler") {
    return {onSchedule: (_opts, _handler) => ({__scheduled: true})};
  }
  if (request === "firebase-functions/params") {
    return {defineSecret: (name) => ({name})};
  }
  if (request === "firebase-admin") {
    return {firestore: () => { throw new Error("not initialised in tests"); }};
  }
  if (request === "./rateLimit") {
    return {checkRateLimit: async () => ({allowed: true})};
  }
  if (request === "./opsAlert") {
    return {sendOpsAlert: async () => ({sent: false})};
  }
  return origLoad.call(this, request, ...rest);
};
const {classifyLimiterHealth, shouldAlertLimiterHealth} = require("./rateLimitHealthCore");
const {runRateLimitHealthCheck} = require("./rateLimitHealth");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

// A fake db that seeds opsRateLimitHealth/status and captures writes.
function fakeDb(seedStatus) {
  const writes = [];
  const state = seedStatus == null ? null : {status: seedStatus};
  return {
    writes,
    collection: () => ({
      doc: () => ({
        get: async () => ({exists: state != null, data: () => state}),
        set: async (data, opts) => writes.push({data, opts}),
      }),
    }),
  };
}

console.log("rateLimitHealth (core)");

ok("kill-switch on → disabled (even if degraded)",
  classifyLimiterHealth({degraded: true, disabled: true}) === "disabled");
ok("degraded transaction → degraded",
  classifyLimiterHealth({degraded: true, disabled: false}) === "degraded");
ok("clean probe → healthy",
  classifyLimiterHealth({degraded: false}) === "healthy");
ok("missing fields → healthy", classifyLimiterHealth({}) === "healthy");

ok("alert on degraded ONSET (previous healthy)",
  shouldAlertLimiterHealth("degraded", "healthy") === true);
ok("alert on degraded onset (no previous state)",
  shouldAlertLimiterHealth("degraded", null) === true);
ok("NO alert while already degraded (edge-triggered)",
  shouldAlertLimiterHealth("degraded", "degraded") === false);
ok("NO alert on recovery (degraded → healthy)",
  shouldAlertLimiterHealth("healthy", "degraded") === false);
ok("NO alert when disabled",
  shouldAlertLimiterHealth("disabled", "healthy") === false);

(async () => {
  console.log("\nrateLimitHealth (runRateLimitHealthCheck)");
  const NOW = new Date("2030-01-02T05:00:00Z");
  const degradedProbe = async () => ({allowed: true, degraded: true});
  const healthyProbe = async () => ({allowed: true});

  // ── healthy probe → no alert, status recorded ────────────────────────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runRateLimitHealthCheck({db, check: healthyProbe, env: {}, now: NOW, alert: async (a) => alerts.push(a)});
    ok("healthy probe → status healthy, no alert", res.status === "healthy" && res.alerted === false && alerts.length === 0);
    ok("status doc written", db.writes.length === 1 && db.writes[0].data.status === "healthy");
  }

  // ── degraded ONSET (previous healthy) → alert ────────────────────────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runRateLimitHealthCheck({db, check: degradedProbe, env: {}, now: NOW, alert: async (a) => alerts.push(a)});
    ok("degraded onset → status degraded + alerted", res.status === "degraded" && res.alerted === true);
    ok("raises an error-severity ops alert",
      alerts.length === 1 && alerts[0].severity === "error" && /DEGRADED/.test(alerts[0].title));
    ok("records lastAlertedAt", db.writes[0].data.lastAlertedAt === NOW.toISOString());
  }

  // ── still degraded (previous degraded) → NO repeat alert ─────────────────
  {
    const db = fakeDb("degraded");
    const alerts = [];
    const res = await runRateLimitHealthCheck({db, check: degradedProbe, env: {}, now: NOW, alert: async (a) => alerts.push(a)});
    ok("sustained degradation does NOT re-alert every hour", res.status === "degraded" && res.alerted === false && alerts.length === 0);
  }

  // ── recovery (previous degraded, now healthy) → no alert ─────────────────
  {
    const db = fakeDb("degraded");
    const alerts = [];
    const res = await runRateLimitHealthCheck({db, check: healthyProbe, env: {}, now: NOW, alert: async (a) => alerts.push(a)});
    ok("recovery is silent (status healthy, no alert)", res.status === "healthy" && res.alerted === false && alerts.length === 0);
  }

  // ── kill-switch on → disabled, never alert even if probe degraded ────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runRateLimitHealthCheck({
      db, check: degradedProbe, env: {RATE_LIMIT_DISABLED: "1"}, now: NOW, alert: async (a) => alerts.push(a),
    });
    ok("kill-switch → disabled, no alert", res.status === "disabled" && res.alerted === false && alerts.length === 0);
  }

  // ── probe itself throws → treated as degraded, still no throw ────────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const throwingProbe = async () => { throw new Error("firestore down"); };
    const res = await runRateLimitHealthCheck({db, check: throwingProbe, env: {}, now: NOW, alert: async (a) => alerts.push(a)});
    ok("a throwing probe is treated as degraded (canary never crashes)", res.status === "degraded" && res.alerted === true);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
