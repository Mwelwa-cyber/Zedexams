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
const {resolveBackupBucket, buildExportRequest} = require("./firestoreBackupCore");
const {runFirestoreExport, dateKeyUtc} = require("./firestoreBackup");
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

ok("dateKeyUtc is YYYY-MM-DD",
  dateKeyUtc(new Date("2030-01-02T03:04:05Z")) === "2030-01-02");

(async () => {
  console.log("\nfirestoreBackup (runFirestoreExport)");
  const NOW = new Date("2030-01-02T03:04:05Z");

  // ── unconfigured → skip, warn, status doc, no throw ──────────────────────
  {
    const db = fakeDb();
    const res = await runFirestoreExport({db, env: {}, now: NOW, alert: async () => {}});
    ok("no bucket configured → skipped-unconfigured", res.status === "skipped-unconfigured");
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("skip is recorded on opsBackups/{date}",
      w && w.data.status === "skipped-unconfigured" && w.opts.merge === true);
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
    ok("export started", res.status === "started");
    ok("Admin API called with the dated all-collections request",
      calls.length === 1 &&
      calls[0].name === "projects/examsprepzambia/databases/(default)" &&
      calls[0].outputUriPrefix === "gs://zedexams-backups/firestore-exports/2030-01-02" &&
      calls[0].collectionIds.length === 0);
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("start recorded with the operation name",
      w && w.data.status === "started" && w.data.operation === "operations/op-123");
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
    ok("failure reported, not thrown", res.status === "failed" && /PERMISSION_DENIED/.test(res.error));
    const w = db.writes.find((x) => x.path === "opsBackups/2030-01-02");
    ok("failure recorded on opsBackups/{date}", w && w.data.status === "failed");
    ok("failure raises an error-severity ops alert",
      alerts.length === 1 && alerts[0].severity === "error" &&
      /FAILED/.test(alerts[0].title));
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
