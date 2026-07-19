/**
 * Node test for the daily Firestore backup export.
 * Run: node functions/firestoreBackup.test.js
 *
 * Covers the pure core (bucket resolution + export request shape) and drives
 * runFirestoreExport through all three outcomes — skipped-unconfigured /
 * started / failed — with injected Firestore, Admin API client, and alert,
 * pinning the contract that a backup failure alerts ops and that every run
 * leaves an opsBackups/{date} status doc.
 */

const assert = require("node:assert");
const Module = require("node:module");

// firestoreBackup.js loads firebase-functions + firebase-admin at import
// time; stub them so the test runs under a root-only `npm ci` (matches
// anthropicClient.test.js's Module._load pattern).
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
  resolveBackupBucket, buildExportRequest, buildImportRequest,
  isProductionRuntime, classifyExportError, selectExportsToDelete,
} = require("./firestoreBackupCore");
const {runFirestoreExport, runBackupRetention, dateKeyUtc, BACKUP_STATUS} =
  require("./firestoreBackup");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// A minimal Firestore stub capturing opsBackups/{date} writes.
function fakeDb() {
  const writes = [];
  return {
    writes,
    collection: (coll) => ({
      doc: (id) => ({
        set: async (data, opts) => writes.push({path: `${coll}/${id}`, data, opts}),
      }),
    }),
  };
}

console.log("firestoreBackup (core)");

// ── resolveBackupBucket ────────────────────────────────────────────────────
ok("bare bucket name → canonical gs:// uri",
  resolveBackupBucket("zedexams-backups") === "gs://zedexams-backups");
ok("gs:// uri passes through", resolveBackupBucket("gs://my-bucket") === "gs://my-bucket");
ok("trailing slash stripped", resolveBackupBucket("gs://my-bucket/") === "gs://my-bucket");
ok("whitespace-only → null (unconfigured)", resolveBackupBucket("   ") === null);
ok("unset → null", resolveBackupBucket(undefined) === null);
ok("invalid bucket chars → null", resolveBackupBucket("Bad Bucket!") === null);

// ── buildExportRequest ─────────────────────────────────────────────────────
{
  const req = buildExportRequest({
    projectId: "examsprepzambia",
    bucketUri: "gs://zedexams-backups",
    dateKey: "2030-01-02",
  });
  ok("request targets the (default) database",
    req.name === "projects/examsprepzambia/databases/(default)");
  ok("dated output prefix",
    req.outputUriPrefix === "gs://zedexams-backups/firestore-exports/2030-01-02");
  ok("exports ALL collections (empty collectionIds)",
    Array.isArray(req.collectionIds) && req.collectionIds.length === 0);
}
assert.throws(() => buildExportRequest({projectId: "", bucketUri: "gs://b", dateKey: "2030-01-02"}));
ok("missing projectId throws", true);
assert.throws(() => buildExportRequest({projectId: "p", bucketUri: "gs://b", dateKey: "bad"}));
ok("malformed dateKey throws", true);

// ── buildImportRequest (restore is the inverse of backup) ──────────────────
{
  const req = buildImportRequest({
    projectId: "examsprepzambia",
    bucketUri: "gs://zedexams-backups",
    dateKey: "2030-01-02",
  });
  ok("import targets the (default) database by default",
    req.name === "projects/examsprepzambia/databases/(default)");
  ok("import reads the SAME dated folder the export wrote",
    req.inputUriPrefix === "gs://zedexams-backups/firestore-exports/2030-01-02");
  ok("import restores ALL collections (empty collectionIds)",
    Array.isArray(req.collectionIds) && req.collectionIds.length === 0);
  const restoreReq = buildImportRequest({
    projectId: "examsprepzambia", bucketUri: "gs://zedexams-backups",
    dateKey: "2030-01-02", databaseId: "restore-scratch",
  });
  ok("import can target a scratch database",
    restoreReq.name === "projects/examsprepzambia/databases/restore-scratch");
}
assert.throws(() => buildImportRequest({projectId: "", bucketUri: "gs://b", dateKey: "2030-01-02"}));
ok("import missing projectId throws", true);
assert.throws(() => buildImportRequest({projectId: "p", bucketUri: "gs://b", dateKey: "bad"}));
ok("import malformed dateKey throws", true);

ok("dateKeyUtc is YYYY-MM-DD",
  dateKeyUtc(new Date("2030-01-02T03:04:05Z")) === "2030-01-02");

// ── isProductionRuntime ────────────────────────────────────────────────────
ok("bare prod-like env → production", isProductionRuntime({}) === true);
ok("FUNCTIONS_EMULATOR=true → non-production",
  isProductionRuntime({FUNCTIONS_EMULATOR: "true"}) === false);
ok("FIRESTORE_EMULATOR_HOST → non-production",
  isProductionRuntime({FIRESTORE_EMULATOR_HOST: "localhost:8080"}) === false);
ok("NODE_ENV=development → non-production",
  isProductionRuntime({NODE_ENV: "development"}) === false);

// ── classifyExportError ────────────────────────────────────────────────────
ok("permission errors categorised",
  classifyExportError("PERMISSION_DENIED: missing IAM").category === "permission");
ok("timeout errors categorised",
  classifyExportError(new Error("DEADLINE_EXCEEDED")).category === "timeout");
ok("bucket errors categorised",
  classifyExportError("NOT_FOUND: no such bucket").category === "destination");
ok("quota errors categorised",
  classifyExportError("RESOURCE_EXHAUSTED: quota").category === "quota");
ok("unknown errors fall through",
  classifyExportError("weird failure").category === "unknown");

// ── selectExportsToDelete (retention safety) ───────────────────────────────
{
  const day = 24 * 60 * 60 * 1000;
  const now = 100 * day;
  const mk = (n, completed = true) =>
    ({path: `p${n}`, dateKey: `d${n}`, createdAtMs: n * day, completed});
  // 10 completed exports spanning 90 days; retentionDays=30, keepMinimum=7.
  const exports = Array.from({length: 10}, (_, i) => mk(90 - i * 9));
  const {toDelete, kept} = selectExportsToDelete(exports, {
    retentionDays: 30, keepMinimum: 7, nowMs: now,
  });
  const newest = exports.slice().sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  ok("retention never deletes the newest completed export",
    !toDelete.some((e) => e.path === newest.path));
  ok("retention keeps at least keepMinimum completed exports",
    kept.filter((e) => e.completed).length >= 7);
  ok("retention only ages out completed exports older than the window",
    toDelete.every((e) => e.createdAtMs < now - 30 * day));

  // Incomplete / in-progress exports are NEVER deleted (fail-safe).
  const withIncomplete = [mk(90), mk(1, false), mk(2, false)];
  const r2 = selectExportsToDelete(withIncomplete, {
    retentionDays: 1, keepMinimum: 1, nowMs: now,
  });
  ok("incomplete exports are never deleted",
    !r2.toDelete.some((e) => e.completed === false) &&
    r2.toDelete.every((e) => e.completed === true));
}

(async () => {
  console.log("\nfirestoreBackup (runFirestoreExport)");
  const NOW = new Date("2030-01-02T03:04:05Z");

  // ── PRODUCTION unconfigured → misconfigured + ERROR alert (loud) ─────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runFirestoreExport({
      db, env: {}, now: NOW, alert: async (a) => alerts.push(a),
    });
    ok("prod + no bucket → misconfigured", res.status === BACKUP_STATUS.MISCONFIGURED);
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("misconfigured recorded on opsBackups/{date} with correlationId",
      w && w.data.status === "misconfigured" && w.opts.merge === true &&
      typeof w.data.correlationId === "string" && w.data.production === true);
    ok("misconfigured backup raises an ERROR-severity ops alert (not silent)",
      alerts.length === 1 && alerts[0].severity === "error" &&
      /MISCONFIGURED/.test(alerts[0].title));
  }

  // ── NON-PRODUCTION unconfigured → explicit skip, NO alert ────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runFirestoreExport({
      db, env: {FUNCTIONS_EMULATOR: "true"}, now: NOW,
      alert: async (a) => alerts.push(a),
    });
    ok("emulator + no bucket → skipped-non-production",
      res.status === BACKUP_STATUS.SKIPPED_NON_PROD);
    ok("non-production skip does NOT alert", alerts.length === 0);
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("non-production skip still records a status doc",
      w && w.data.status === "skipped-non-production");
  }

  // ── configured → export kicked off, status 'started' ─────────────────────
  {
    const db = fakeDb();
    const calls = [];
    const adminClient = {
      exportDocuments: async (req) => {
        calls.push(req);
        return [{name: "operations/op-123"}];
      },
    };
    const res = await runFirestoreExport({
      db, adminClient, now: NOW, alert: async () => {},
      env: {FIRESTORE_BACKUP_BUCKET: "zedexams-backups", GCLOUD_PROJECT: "examsprepzambia"},
    });
    ok("export started", res.status === BACKUP_STATUS.STARTED);
    ok("Admin API called with the dated all-collections request",
      calls.length === 1 &&
      calls[0].name === "projects/examsprepzambia/databases/(default)" &&
      calls[0].outputUriPrefix === "gs://zedexams-backups/firestore-exports/2030-01-02" &&
      calls[0].collectionIds.length === 0);
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("start recorded with the operation name + completed:false (not success)",
      w && w.data.status === "started" &&
      w.data.operationName === "operations/op-123" &&
      w.data.completed === false && w.data.exportPath &&
      typeof w.data.correlationId === "string");
  }

  // ── failure → status 'failed' + ops alert, still no throw ────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const adminClient = {
      exportDocuments: async () => { throw new Error("PERMISSION_DENIED: missing IAM"); },
    };
    const res = await runFirestoreExport({
      db, adminClient, now: NOW,
      alert: async (a) => alerts.push(a),
      env: {FIRESTORE_BACKUP_BUCKET: "gs://zedexams-backups", GCLOUD_PROJECT: "examsprepzambia"},
    });
    ok("failure reported, not thrown", res.status === BACKUP_STATUS.FAILED && /PERMISSION_DENIED/.test(res.error));
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("failure recorded on opsBackups/{date} with error category",
      w && w.data.status === "failed" && w.data.errorCategory === "permission");
    ok("failure raises an error-severity ops alert",
      alerts.length === 1 && alerts[0].severity === "error" &&
      /FAILED/.test(alerts[0].title));
  }

  // ── retention runner: dry-run plans, apply deletes, never the newest ─────
  {
    const day = 24 * 60 * 60 * 1000;
    const now = 100 * day;
    const exps = Array.from({length: 10}, (_, i) =>
      ({path: `p${i}`, dateKey: `d${i}`, createdAtMs: (90 - i * 9) * day, completed: true}));
    const deleted = [];
    const listExports = async () => exps;
    const deleteExport = async (p) => { deleted.push(p); };

    const dry = await runBackupRetention({
      listExports, deleteExport, apply: false, nowMs: now,
    });
    ok("dry-run plans deletions but deletes nothing",
      dry.planned > 0 && dry.deleted === 0 && deleted.length === 0);

    const live = await runBackupRetention({
      listExports, deleteExport, apply: true, nowMs: now,
    });
    ok("apply deletes exactly the planned set",
      live.deleted === live.planned && deleted.length === live.planned);
    const newest = exps.slice().sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
    ok("retention runner never deletes the newest export",
      !deleted.includes(newest.path));
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
