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
const {
  runFirestoreExport, runBackupRetention, runBackupCompletionCheck,
  recentUtcDateKeys, dateKeyUtc, BACKUP_STATUS,
} = require("./firestoreBackup");
const {
  dailyStatusRank, shouldWriteDailyStatus, decideBackupOwnership, decideCompletion,
} = require("./firestoreBackupCore");
Module._load = origLoad;

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// A Firestore stub that keeps per-doc STATE (so transactions can read prior
// state) and captures every write. Supports doc.get/doc.set and runTransaction
// with tx.get/tx.set — enough to drive the ownership lease + monotonic daily
// summary + immutable per-run record paths.
function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed)); // path -> data object
  const writes = [];
  const applySet = (path, data, opts) => {
    const prev = opts && opts.merge ? (store.get(path) || {}) : {};
    store.set(path, {...prev, ...data});
    writes.push({path, data, opts});
  };
  const makeRef = (path) => ({
    path,
    get: async () => ({exists: store.has(path), data: () => store.get(path)}),
    set: async (data, opts) => applySet(path, data, opts),
  });
  return {
    store, writes,
    collection: (coll) => ({doc: (id) => makeRef(`${coll}/${id}`)}),
    runTransaction: async (fn) => fn({
      get: async (ref) => ({exists: store.has(ref.path), data: () => store.get(ref.path)}),
      set: (ref, data, opts) => applySet(ref.path, data, opts),
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
    // Final daily-summary state (the run claims in_progress, then writes started).
    const doc = db.store.get("opsBackups/2030-01-02");
    ok("start recorded with the operation name + completed:false (not success)",
      doc && doc.status === "started" &&
      doc.operationName === "operations/op-123" &&
      doc.completed === false && doc.exportPath &&
      typeof doc.correlationId === "string" && typeof doc.owner === "string");
    // Immutable per-execution record written under opsBackupRuns/{correlationId}.
    const runWrite = db.writes.find((x) => x.path.startsWith("opsBackupRuns/"));
    ok("an immutable opsBackupRuns/{correlationId} record is written",
      runWrite && runWrite.data.status === "started" &&
      runWrite.path === `opsBackupRuns/${doc.owner}` &&
      (!runWrite.opts || runWrite.opts.merge !== true));
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
    // The owner must be able to record its OWN acceptance failure even though it
    // first claimed the date as 'in_progress' (the WIP monotonic-guard bug).
    const doc = db.store.get("opsBackups/2030-01-02");
    ok("failure recorded on opsBackups/{date} with error category",
      doc && doc.status === "failed" && doc.errorCategory === "permission");
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

  // ── DR-007 core helpers (pure) ───────────────────────────────────────────
  console.log("\nfirestoreBackup (DR-007 same-UTC-date hardening)");

  ok("daily status rank orders completed > started > in_progress > failed > skip",
    dailyStatusRank("completed") > dailyStatusRank("started") &&
    dailyStatusRank("started") > dailyStatusRank("in_progress") &&
    dailyStatusRank("in_progress") > dailyStatusRank("failed") &&
    dailyStatusRank("failed") > dailyStatusRank("duplicate-skipped"));
  ok("monotonic guard blocks a duplicate 'failed' from downgrading 'started'",
    shouldWriteDailyStatus("started", "failed") === false);
  ok("monotonic guard allows an upgrade (started → completed)",
    shouldWriteDailyStatus("started", "completed") === true);
  ok("force overrides the monotonic guard (authoritative completion checker)",
    shouldWriteDailyStatus("completed", "failed", {force: true}) === true);
  ok("a date with a started export is OWNED → a second run duplicate-skips",
    decideBackupOwnership({status: "started"}).action === "duplicate-skip");
  ok("a date with a completed export is OWNED → duplicate-skip",
    decideBackupOwnership({status: "completed"}).action === "duplicate-skip");
  ok("a fresh/failed date can be CLAIMED",
    decideBackupOwnership(null).action === "claim" &&
    decideBackupOwnership({status: "failed"}).action === "claim");
  ok("decideCompletion: undone op → pending",
    decideCompletion({done: false}).state === "pending");
  ok("decideCompletion: done+error → failed",
    decideCompletion({done: true, error: {message: "boom"}}).state === "failed");
  ok("decideCompletion: done, no error → completed",
    decideCompletion({done: true, metadata: {outputUriPrefix: "gs://b/x"}}).state === "completed");

  // ── Same-date collision: a duplicate run must NOT downgrade the summary ────
  {
    const NOW2 = new Date("2030-05-05T01:00:00Z");
    const env = {FIRESTORE_BACKUP_BUCKET: "zedexams-backups", GCLOUD_PROJECT: "examsprepzambia"};
    // Run A: a normal export that reaches 'started'.
    const db = fakeDb();
    await runFirestoreExport({
      db, now: NOW2, alert: async () => {}, env,
      adminClient: {exportDocuments: async () => [{name: "operations/opA"}]},
    });
    const afterA = db.store.get("opsBackups/2030-05-05");
    ok("run A owns the date with a 'started' summary", afterA.status === "started");

    // Run B: same UTC date, but the export would FAIL. It must be a
    // duplicate-skip and must NOT downgrade A's 'started' summary to 'failed'.
    const bAlerts = [];
    const resB = await runFirestoreExport({
      db, now: NOW2, alert: async (a) => bAlerts.push(a), env,
      adminClient: {exportDocuments: async () => { throw new Error("PERMISSION_DENIED"); }},
    });
    ok("run B is a duplicate-skip, NOT a failure",
      resB.status === BACKUP_STATUS.DUPLICATE_SKIPPED);
    const afterB = db.store.get("opsBackups/2030-05-05");
    ok("the daily summary is STILL 'started' (a duplicate can't downgrade it)",
      afterB.status === "started");
    ok("a duplicate-skip raises no failure alert", bAlerts.length === 0);
    ok("run B still wrote its OWN immutable opsBackupRuns record",
      db.writes.filter((x) => x.path.startsWith("opsBackupRuns/")).length === 2);
  }

  // ── Completion checker flips started → completed, and records real failures ─
  {
    const db = fakeDb({
      "opsBackups/2030-06-06": {
        status: "started", completed: false, operationName: "operations/opDone",
      },
      "opsBackups/2030-06-07": {
        status: "started", completed: false, operationName: "operations/opFail",
      },
      "opsBackups/2030-06-08": {status: "completed", completed: true}, // already settled
    });
    const alerts = [];
    const out = await runBackupCompletionCheck({
      db,
      dateKeys: ["2030-06-06", "2030-06-07", "2030-06-08"],
      alert: async (a) => alerts.push(a),
      getOperation: async (name) => name === "operations/opDone"
        ? {done: true, metadata: {outputUriPrefix: "gs://b/x"}}
        : {done: true, error: {message: "export op failed server-side"}},
    });
    ok("completion checker settles the two started summaries, skips the settled one",
      out.checked === 2 && out.completed === 1 && out.failed === 1);
    ok("a finished operation flips the summary to completed:true",
      db.store.get("opsBackups/2030-06-06").status === "completed" &&
      db.store.get("opsBackups/2030-06-06").completed === true);
    ok("a genuinely failed operation is recorded as failed (post-acceptance)",
      db.store.get("opsBackups/2030-06-07").status === "failed" &&
      db.store.get("opsBackups/2030-06-07").completed === false);
    ok("the post-acceptance failure alerts ops", alerts.length === 1);
    ok("an already-completed summary is left untouched (idempotent)",
      db.store.get("opsBackups/2030-06-08").status === "completed");
  }

  // ── recentUtcDateKeys covers today + yesterday (a 01:30 Lusaka run stamps
  //    the previous UTC day, so the checker must look back one). ─────────────
  {
    const keys = recentUtcDateKeys(new Date("2030-07-01T02:00:00Z"));
    ok("recentUtcDateKeys returns today + yesterday (UTC)",
      keys.length === 2 && keys[0] === "2030-07-01" && keys[1] === "2030-06-30");
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
