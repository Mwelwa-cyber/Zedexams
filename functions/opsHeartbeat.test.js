/**
 * Node test for the cross-subsystem ops dead-man's-switch (OBS-004).
 * Run: node functions/opsHeartbeat.test.js
 *
 * Covers the pure core (timestamp extraction, classify, summarize,
 * edge-triggered alert) and drives runOpsHeartbeatCheck through all-fresh /
 * one-stale / one-missing / recovery / sustained with injected timestamps +
 * fake Firestore + alert, pinning that a STOPPED scheduled job (stale/missing
 * heartbeat) alerts ONCE at onset and never crashes the switch.
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
  if (request === "./opsAlert") {
    return {sendOpsAlert: async () => ({sent: false})};
  }
  return origLoad.call(this, request, ...rest);
};
const {
  HEARTBEATS, HOUR_MS, docTimestampMs, classifyHeartbeat, summarizeHeartbeats,
  shouldAlertHeartbeat, recentUtcDateKeys,
} = require("./opsHeartbeatCore");
const {runOpsHeartbeatCheck} = require("./opsHeartbeat");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

function fakeDb(seedVerdict) {
  const writes = [];
  const state = seedVerdict == null ? null : {verdict: seedVerdict};
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

console.log("opsHeartbeat (core)");

const NOW_MS = Date.parse("2030-01-02T12:00:00Z");

ok("docTimestampMs takes the freshest known ISO field",
  docTimestampMs({ranAt: "2030-01-02T00:00:00Z", checkedAt: "2030-01-02T06:00:00Z"}) === Date.parse("2030-01-02T06:00:00Z"));
ok("docTimestampMs → null when no parseable timestamp", docTimestampMs({foo: "bar"}) === null);
ok("docTimestampMs → null on non-object", docTimestampMs(null) === null);

ok("recent heartbeat → fresh",
  classifyHeartbeat({latestTsMs: NOW_MS - 2 * HOUR_MS, nowMs: NOW_MS, maxAgeMs: 4 * HOUR_MS}) === "fresh");
ok("older than maxAge → stale",
  classifyHeartbeat({latestTsMs: NOW_MS - 8 * HOUR_MS, nowMs: NOW_MS, maxAgeMs: 4 * HOUR_MS}) === "stale");
ok("no timestamp → missing",
  classifyHeartbeat({latestTsMs: null, nowMs: NOW_MS, maxAgeMs: 4 * HOUR_MS}) === "missing");

{
  const s = summarizeHeartbeats([
    {name: "a", status: "fresh"}, {name: "b", status: "stale"}, {name: "c", status: "missing"},
  ]);
  ok("summarize → unhealthy with stale+missing listed",
    s.verdict === "unhealthy" && s.stale.includes("b") && s.missing.includes("c") && s.unhealthy.length === 2);
  ok("all fresh → healthy",
    summarizeHeartbeats([{name: "a", status: "fresh"}]).verdict === "healthy");
}

ok("alert on unhealthy ONSET (previous healthy)", shouldAlertHeartbeat("unhealthy", "healthy") === true);
ok("alert on onset with no previous state", shouldAlertHeartbeat("unhealthy", null) === true);
ok("NO re-alert while already unhealthy", shouldAlertHeartbeat("unhealthy", "unhealthy") === false);
ok("NO alert on recovery", shouldAlertHeartbeat("healthy", "unhealthy") === false);

ok("recentUtcDateKeys returns N newest-first UTC dates",
  (() => { const k = recentUtcDateKeys(new Date("2030-03-02T01:00:00Z"), 3);
    return k.length === 3 && k[0] === "2030-03-02" && k[2] === "2030-02-28"; })());

ok("HEARTBEATS registry covers the four ops subsystems",
  HEARTBEATS.length === 4 && HEARTBEATS.map((h) => h.name).sort().join(",") ===
    "firestore-backup,function-error-watch,ratelimit-health,storage-backup");

// The error watch is the one entry guarding a MONITOR rather than a job, and it
// is here because that monitor's healthy output is silence — "no alerts" and
// "no runs" are the same observation until something checks the heartbeat.
ok("the error-watch heartbeat is tighter than the backup ones, matching its cadence",
  (() => {
    const hb = HEARTBEATS.find((h) => h.name === "function-error-watch");
    return hb.kind === "doc" && hb.collection === "opsMonitorState" &&
      hb.doc === "functionErrorsHeartbeat" && hb.maxAgeHours === 1;
  })());

(async () => {
  console.log("\nopsHeartbeat (runOpsHeartbeatCheck)");
  const NOW = new Date("2030-01-02T12:00:00Z");
  // Map heartbeat name → age (hours) to synthesize a timestamp; null = missing.
  const mkRead = (agesByName) => async (_db, hb) => {
    const age = agesByName[hb.name];
    return age == null ? null : NOW.getTime() - age * HOUR_MS;
  };
  // Ages in HOURS. The error watch runs every 5 minutes with a 1h maxAge, so a
  // fresh value for it is well under an hour — 0.1 is six minutes.
  const allFresh = {"firestore-backup": 5, "storage-backup": 3, "ratelimit-health": 1,
    "function-error-watch": 0.1};

  // ── all heartbeats fresh → healthy, no alert ─────────────────────────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runOpsHeartbeatCheck({db, readTimestamp: mkRead(allFresh), now: NOW, alert: async (a) => alerts.push(a)});
    ok("all fresh → healthy, no alert", res.verdict === "healthy" && res.alerted === false && alerts.length === 0);
    ok("records the fleet verdict + per-heartbeat detail",
      db.writes[0].data.verdict === "healthy" && Array.isArray(db.writes[0].data.heartbeats) &&
      db.writes[0].data.heartbeats.length === HEARTBEATS.length);
  }

  // ── a stopped hourly limiter cron (stale) → onset alert ──────────────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runOpsHeartbeatCheck({
      db, now: NOW, alert: async (a) => alerts.push(a),
      readTimestamp: mkRead({...allFresh, "ratelimit-health": 9}), // 9h > 4h maxAge
    });
    ok("stale limiter heartbeat → unhealthy + alerted", res.verdict === "unhealthy" && res.alerted === true && res.unhealthy.includes("ratelimit-health"));
    ok("alert names the stopped job", alerts.length === 1 && /STALE/.test(alerts[0].title) && alerts[0].lines.join("\n").includes("ratelimit-health"));
  }

  // ── a missing backup heartbeat → unhealthy ───────────────────────────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runOpsHeartbeatCheck({
      db, now: NOW, alert: async (a) => alerts.push(a),
      readTimestamp: mkRead({...allFresh, "storage-backup": null}),
    });
    ok("missing heartbeat → unhealthy + alert", res.verdict === "unhealthy" && res.unhealthy.includes("storage-backup") && alerts.length === 1);
  }

  // ── sustained unhealthy (previous unhealthy) → NO repeat alert ────────────
  {
    const db = fakeDb("unhealthy");
    const alerts = [];
    const res = await runOpsHeartbeatCheck({
      db, now: NOW, alert: async (a) => alerts.push(a),
      readTimestamp: mkRead({...allFresh, "ratelimit-health": 9}),
    });
    ok("sustained outage does NOT re-alert every run", res.verdict === "unhealthy" && res.alerted === false && alerts.length === 0);
  }

  // ── recovery (previous unhealthy, now all fresh) → silent ────────────────
  {
    const db = fakeDb("unhealthy");
    const alerts = [];
    const res = await runOpsHeartbeatCheck({db, now: NOW, alert: async (a) => alerts.push(a), readTimestamp: mkRead(allFresh)});
    ok("recovery is silent (healthy, no alert)", res.verdict === "healthy" && res.alerted === false && alerts.length === 0);
  }

  // ── a throwing probe is treated as missing, switch never throws ──────────
  {
    const db = fakeDb("healthy");
    const alerts = [];
    const res = await runOpsHeartbeatCheck({
      db, now: NOW, alert: async (a) => alerts.push(a),
      readTimestamp: async () => { throw new Error("firestore read failed"); },
    });
    ok("all reads throwing → all missing → unhealthy, never throws",
      res.verdict === "unhealthy" && res.unhealthy.length === HEARTBEATS.length);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
