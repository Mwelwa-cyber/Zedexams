/**
 * Node test for the Firebase Storage backup health check (DR-003).
 * Run: node functions/storageBackup.test.js
 *
 * Covers the pure core (bucket resolution + freshness classification) and
 * drives runStorageBackupCheck through every outcome — misconfigured / skip /
 * empty / stale / fresh / error — with injected Firestore, freshness probe and
 * alert, pinning that a broken/absent Storage mirror ALERTS and that every run
 * records an opsStorageBackups/{date} status doc.
 */

const assert = require("node:assert");
const Module = require("node:module");

// storageBackup.js loads firebase-functions + firebase-admin at import; stub
// them so the test runs under a root-only install (matches firestoreBackup.test).
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-functions/v2/scheduler") {
    return {onSchedule: (_opts, _handler) => ({__scheduled: true})};
  }
  if (request === "firebase-functions/params") {
    return {defineSecret: (name) => ({name})};
  }
  if (request === "firebase-admin") {
    return {firestore: () => { throw new Error("not initialised in tests"); },
      storage: () => { throw new Error("not initialised in tests"); }};
  }
  if (request === "./opsAlert") {
    return {sendOpsAlert: async () => ({sent: false})};
  }
  return origLoad.call(this, request, ...rest);
};
const {
  resolveStorageBackupBucket, classifyBackupFreshness, resolveMaxAgeMs,
  DEFAULT_MAX_AGE_HOURS, HOUR_MS,
} = require("./storageBackupCore");
const {runStorageBackupCheck, STORAGE_BACKUP_STATUS} = require("./storageBackup");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

function fakeDb() {
  const writes = [];
  return {
    writes,
    collection: (coll) => ({
      doc: (id) => ({set: async (data, opts) => writes.push({path: `${coll}/${id}`, data, opts})}),
    }),
  };
}

console.log("storageBackup (core)");

// ── resolveStorageBackupBucket → BARE name ─────────────────────────────────
ok("bare name passes through", resolveStorageBackupBucket("zedexams-storage-backup") === "zedexams-storage-backup");
ok("gs:// stripped to bare name", resolveStorageBackupBucket("gs://zedexams-storage-backup") === "zedexams-storage-backup");
ok("trailing slash stripped", resolveStorageBackupBucket("gs://my-bucket/") === "my-bucket");
ok("unset → null", resolveStorageBackupBucket(undefined) === null);
ok("blank → null", resolveStorageBackupBucket("   ") === null);
ok("invalid chars → null", resolveStorageBackupBucket("Bad Bucket!") === null);

// ── classifyBackupFreshness ────────────────────────────────────────────────
const NOW_MS = Date.parse("2030-01-02T04:00:00Z");
ok("no objects → empty",
  classifyBackupFreshness({latestUpdatedMs: null, nowMs: NOW_MS}).status === "empty");
ok("recent object → fresh",
  classifyBackupFreshness({latestUpdatedMs: NOW_MS - 2 * HOUR_MS, nowMs: NOW_MS}).status === "fresh");
ok("object older than threshold → stale",
  classifyBackupFreshness({latestUpdatedMs: NOW_MS - 48 * HOUR_MS, nowMs: NOW_MS}).status === "stale");
ok("exactly at threshold is still fresh (boundary)",
  classifyBackupFreshness({latestUpdatedMs: NOW_MS - DEFAULT_MAX_AGE_HOURS * HOUR_MS, nowMs: NOW_MS}).status === "fresh");
ok("custom maxAge honoured",
  classifyBackupFreshness({latestUpdatedMs: NOW_MS - 10 * HOUR_MS, nowMs: NOW_MS, maxAgeMs: 6 * HOUR_MS}).status === "stale");
ok("ageMs is never negative for a future timestamp",
  classifyBackupFreshness({latestUpdatedMs: NOW_MS + HOUR_MS, nowMs: NOW_MS}).ageMs === 0);

// ── resolveMaxAgeMs ────────────────────────────────────────────────────────
ok("default when unset", resolveMaxAgeMs(undefined) === DEFAULT_MAX_AGE_HOURS * HOUR_MS);
ok("default when non-positive", resolveMaxAgeMs("0") === DEFAULT_MAX_AGE_HOURS * HOUR_MS);
ok("custom hours honoured", resolveMaxAgeMs("12") === 12 * HOUR_MS);

(async () => {
  console.log("\nstorageBackup (runStorageBackupCheck)");
  const NOW = new Date("2030-01-02T04:00:00Z");
  const configured = {STORAGE_BACKUP_BUCKET: "zedexams-storage-backup"};

  // ── PRODUCTION unconfigured → misconfigured + ERROR alert ────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({db, env: {}, now: NOW, alert: async (a) => alerts.push(a)});
    ok("prod + no backup bucket → misconfigured", res.status === STORAGE_BACKUP_STATUS.MISCONFIGURED);
    ok("misconfigured raises an error-severity alert",
      alerts.length === 1 && alerts[0].severity === "error" && /MISCONFIGURED/.test(alerts[0].title));
    const w = db.writes.find((x) => x.path === "opsStorageBackups/2030-01-02");
    ok("misconfigured recorded on opsStorageBackups/{date} with correlationId",
      w && w.data.status === "misconfigured" && typeof w.data.correlationId === "string" && w.opts.merge === true);
  }

  // ── NON-PRODUCTION unconfigured → skip, no alert ─────────────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: {FUNCTIONS_EMULATOR: "true"}, now: NOW, alert: async (a) => alerts.push(a),
    });
    ok("emulator + no bucket → skipped-non-production", res.status === STORAGE_BACKUP_STATUS.SKIPPED_NON_PROD);
    ok("non-production skip does NOT alert", alerts.length === 0);
    ok("non-production skip still records a status doc",
      db.writes.some((x) => x.path === "opsStorageBackups/2030-01-02" && x.data.status === "skipped-non-production"));
  }

  // ── configured + recent object → fresh, no alert ─────────────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const probe = async () => ({latestUpdatedMs: NOW.getTime() - 3 * HOUR_MS, scanned: 1200});
    const res = await runStorageBackupCheck({db, env: configured, now: NOW, probe, alert: async (a) => alerts.push(a)});
    ok("recent mirror object → fresh", res.status === STORAGE_BACKUP_STATUS.FRESH);
    ok("a fresh backup raises NO alert", alerts.length === 0);
    const w = db.writes.find((x) => x.path === "opsStorageBackups/2030-01-02");
    ok("fresh recorded with ageHours + latestObjectAt + scanned",
      w && w.data.status === "fresh" && typeof w.data.ageHours === "number" &&
      w.data.latestObjectAt && w.data.scanned === 1200);
  }

  // ── configured + stale object → stale + alert ────────────────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const probe = async () => ({latestUpdatedMs: NOW.getTime() - 50 * HOUR_MS, scanned: 900});
    const res = await runStorageBackupCheck({db, env: configured, now: NOW, probe, alert: async (a) => alerts.push(a)});
    ok("mirror older than threshold → stale", res.status === STORAGE_BACKUP_STATUS.STALE);
    ok("a stale backup alerts ops (mirror stopped)",
      alerts.length === 1 && /STALE/.test(alerts[0].title));
  }

  // ── configured + empty destination → empty + alert ───────────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const probe = async () => ({latestUpdatedMs: null, scanned: 0});
    const res = await runStorageBackupCheck({db, env: configured, now: NOW, probe, alert: async (a) => alerts.push(a)});
    ok("no objects in the backup destination → empty", res.status === STORAGE_BACKUP_STATUS.EMPTY);
    ok("an empty backup alerts ops (mirror never ran)",
      alerts.length === 1 && /EMPTY/.test(alerts[0].title));
  }

  // ── probe itself throws → error status + alert, never throws ─────────────
  {
    const db = fakeDb();
    const alerts = [];
    const probe = async () => { throw new Error("PERMISSION_DENIED listing bucket"); };
    const res = await runStorageBackupCheck({db, env: configured, now: NOW, probe, alert: async (a) => alerts.push(a)});
    ok("a probe failure is reported, not thrown", res.status === STORAGE_BACKUP_STATUS.ERROR);
    ok("a probe failure alerts ops (health unknown)",
      alerts.length === 1 && /ERRORED/.test(alerts[0].title));
    ok("probe error recorded with the message",
      db.writes.some((x) => x.path === "opsStorageBackups/2030-01-02" && /PERMISSION_DENIED/.test(x.data.error || "")));
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
