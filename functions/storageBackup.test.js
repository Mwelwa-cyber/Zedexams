/**
 * Node test for the Firebase Storage backup health check (DR-003).
 * Run: node functions/storageBackup.test.js
 *
 * Covers the pure cores (bucket resolution + heartbeat classification) and
 * drives runStorageBackupCheck through every outcome — misconfigured / skip /
 * awaiting / empty / stale / fresh / error — with injected Firestore, heartbeat
 * probe and alert.
 *
 * The load-bearing case is the one named "a quiet source bucket does NOT make a
 * healthy mirror look stale". The check previously inferred "did the mirror
 * run" from "did any object change", which under --overwrite-when=different is
 * a fact about the SOURCE, not the mirror — so a quiet night paged `stale`
 * about a perfectly good backup. Everything else here is scaffolding around
 * keeping that distinction true.
 */

const assert = require("node:assert");
const Module = require("node:module");

// storageBackup.js loads firebase-functions + firebase-admin at import; stub
// them so the test runs under a root-only install (matches firestoreBackup.test).
// `__bucket` is a mutable hook so the heartbeat I/O tests can drive the real
// writeStorageBackupHeartbeat/probeHeartbeat against a fake bucket — the module
// captures this one object at require time, so replacing the hook later still
// reaches it.
const adminStub = {
  firestore: () => { throw new Error("not initialised in tests"); },
  storage: () => ({bucket: (name) => adminStub.__bucket(name)}),
  __bucket: () => { throw new Error("no bucket stub installed"); },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-functions/v2/scheduler") {
    return {onSchedule: (_opts, _handler) => ({__scheduled: true})};
  }
  if (request === "firebase-functions/params") {
    return {defineSecret: (name) => ({name})};
  }
  if (request === "firebase-admin") return adminStub;
  if (request === "./opsAlert") {
    return {sendOpsAlert: async () => ({sent: false})};
  }
  return origLoad.call(this, request, ...rest);
};
const {
  resolveStorageBackupBucket, resolveMaxAgeMs, DEFAULT_MAX_AGE_HOURS, HOUR_MS,
} = require("./storageBackupCore");
const {
  HEARTBEAT_PATH, STORAGE_HEARTBEAT_STATUS, classifyHeartbeat, buildHeartbeatBody,
} = require("./storageBackupHeartbeatCore");
const {
  runStorageBackupCheck, STORAGE_BACKUP_STATUS,
  writeStorageBackupHeartbeat, probeHeartbeat,
} = require("./storageBackup");
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

// ── classifyHeartbeat — the whole verdict, so tested exhaustively ─────────
const NOW_MS = Date.parse("2030-01-02T04:00:00Z");
const hbAt = (primary, backup) =>
  classifyHeartbeat({primaryUpdatedMs: primary, backupUpdatedMs: backup, nowMs: NOW_MS});

ok("recently mirrored → fresh",
  hbAt(NOW_MS - 4 * HOUR_MS, NOW_MS - 2 * HOUR_MS).status === "fresh");
ok("mirrored copy older than threshold → stale",
  hbAt(NOW_MS - 2 * HOUR_MS, NOW_MS - 48 * HOUR_MS).status === "stale");
// Boundary on AGE, with the mirror caught up (primary older than its copy, as
// it always is in healthy operation). The primary must be older than the backup
// here: pinning it at `now` would describe a mirror 12h behind its source,
// which the lag test correctly calls stale — a different case, tested below.
ok("exactly at the age threshold is still fresh (boundary)",
  hbAt(NOW_MS - (DEFAULT_MAX_AGE_HOURS + 1) * HOUR_MS,
    NOW_MS - DEFAULT_MAX_AGE_HOURS * HOUR_MS).status === "fresh");
// The same age, but reached because the SOURCE moved on without the mirror.
ok("...but the same age with the mirror behind its source is stale",
  hbAt(NOW_MS, NOW_MS - DEFAULT_MAX_AGE_HOURS * HOUR_MS).status === "stale");
ok("written but never mirrored → empty",
  hbAt(NOW_MS - 2 * HOUR_MS, null).status === "empty");

// The asymmetry that keeps a new deploy from paging: no heartbeat on the
// PRIMARY means OUR writer hasn't run, which says nothing about the mirror.
ok("never written → awaiting, not empty",
  hbAt(null, null).status === "awaiting-heartbeat");
ok("never written outranks an old backup copy",
  hbAt(null, NOW_MS - 500 * HOUR_MS).status === "awaiting-heartbeat");

ok("custom maxAge honoured",
  classifyHeartbeat({
    primaryUpdatedMs: NOW_MS, backupUpdatedMs: NOW_MS - 10 * HOUR_MS,
    nowMs: NOW_MS, maxAgeMs: 6 * HOUR_MS,
  }).status === "stale");
ok("mirror lag is the gap between the two sides",
  hbAt(NOW_MS - 2 * HOUR_MS, NOW_MS - 5 * HOUR_MS).lagMs === 3 * HOUR_MS);
ok("lag is never negative when the backup leads",
  hbAt(NOW_MS - 5 * HOUR_MS, NOW_MS - 2 * HOUR_MS).lagMs === 0);
ok("ageMs is never negative for a future timestamp",
  hbAt(NOW_MS, NOW_MS + HOUR_MS).ageMs === 0);
ok("a non-numeric timestamp is treated as absent, never as 1970",
  hbAt("nonsense", NOW_MS).status === "awaiting-heartbeat");

// ── the heartbeat body explains itself to whoever finds it ────────────────
{
  const body = JSON.parse(buildHeartbeatBody(new Date(NOW_MS), "cid-1"));
  ok("the body says what it is and that deleting it is safe",
    /heartbeat/i.test(body.what) && /safe to delete/i.test(body.why));
  ok("the body records when it was written", body.writtenAt === "2030-01-02T04:00:00.000Z");
  ok("the heartbeat lives under _ops/", HEARTBEAT_PATH.startsWith("_ops/"));
}

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

  // ── HEARTBEAT: the mirror carried a recent token across → fresh ─────────
  // `heartbeat(bucket)` is called twice: undefined = primary, name = backup.
  const hb = (primaryMs, backupMs) => async (bucket) =>
    (bucket === undefined ? primaryMs : backupMs);

  {
    const db = fakeDb();
    const alerts = [];
    const written = NOW.getTime() - 4.5 * HOUR_MS;
    const mirrored = NOW.getTime() - 2 * HOUR_MS;
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW, heartbeat: hb(written, mirrored),
      alert: async (a) => alerts.push(a),
    });
    ok("a recently mirrored heartbeat → fresh", res.status === STORAGE_BACKUP_STATUS.FRESH);
    ok("a fresh mirror raises NO alert", alerts.length === 0);
    ok("fresh records both sides' timestamps and the path",
      db.writes.some((x) => x.data.heartbeatPath === "_ops/storage-backup-heartbeat.json" &&
        x.data.heartbeatWrittenAt && x.data.heartbeatMirroredAt));
  }

  // ── THE BUG THIS REPLACED ────────────────────────────────────────────────
  // A quiet source bucket — nothing uploaded or changed for days — used to age
  // the newest destination object past the threshold and page `stale` about a
  // perfectly healthy mirror. The heartbeat is rewritten nightly and copied
  // every run, so source quiet cannot reach the verdict at all.
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW,
      heartbeat: hb(NOW.getTime() - 4.5 * HOUR_MS, NOW.getTime() - 2 * HOUR_MS),
      alert: async (a) => alerts.push(a),
    });
    ok("a quiet source bucket does NOT make a healthy mirror look stale",
      res.status === STORAGE_BACKUP_STATUS.FRESH && alerts.length === 0);
  }

  // ── the mirror genuinely stopped → stale + alert ─────────────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW,
      heartbeat: hb(NOW.getTime() - 2 * HOUR_MS, NOW.getTime() - 50 * HOUR_MS),
      alert: async (a) => alerts.push(a),
    });
    ok("a heartbeat the mirror stopped carrying → stale",
      res.status === STORAGE_BACKUP_STATUS.STALE);
    ok("a stopped mirror alerts ops",
      alerts.length === 1 && /STALE/.test(alerts[0].title) && alerts[0].severity === "error");
    ok("the lag between the two sides is reported",
      db.writes.some((x) => x.data.mirrorLagHours === 48));
  }

  // ── our writer stopped, the mirror did NOT → name the right system ──────
  // Reported as `stale` before this, which sent the reader to debug a transfer
  // job that was working perfectly while the actual broken cron kept not
  // running.
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW,
      // Primary heartbeat is old; the mirror faithfully carried that old copy,
      // so the backup is level with it — no lag.
      heartbeat: hb(NOW.getTime() - 40 * HOUR_MS, NOW.getTime() - 39 * HOUR_MS),
      alert: async (a) => alerts.push(a),
    });
    ok("an old heartbeat with a caught-up mirror → heartbeat-writer-stopped",
      res.status === STORAGE_BACKUP_STATUS.WRITER_STOPPED);
    ok("the alert says the mirror is fine and our cron isn't",
      alerts.length === 1 && /heartbeat STOPPED/.test(alerts[0].title) &&
      /storageBackupHeartbeat/.test(alerts[0].lines.join(" ")));
    ok("it does NOT tell them to go and look at the transfer job",
      !/transfer job appears to have stopped/i.test(alerts[0].lines.join(" ")));
  }

  // ── heartbeat never reached the backup → empty + alert ───────────────────
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW,
      heartbeat: hb(NOW.getTime() - 2 * HOUR_MS, null),
      alert: async (a) => alerts.push(a),
    });
    ok("written but never mirrored → empty", res.status === STORAGE_BACKUP_STATUS.EMPTY);
    ok("a mirror that never copied it alerts ops",
      alerts.length === 1 && /EMPTY/.test(alerts[0].title));
  }

  // ── our writer hasn't run → NOT an error about the mirror ────────────────
  // The first night after deploy looks exactly like this. Paging here is how
  // an alert channel earns the mute it later gets when something is real.
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW, heartbeat: hb(null, null),
      alert: async (a) => alerts.push(a),
    });
    ok("no heartbeat on the primary → awaiting, not empty/stale",
      res.status === STORAGE_BACKUP_STATUS.AWAITING);
    ok("a missing heartbeat WARNS rather than paging",
      alerts.length === 1 && alerts[0].severity === "warning");
    ok("it blames our writer, not the mirror",
      /NOT YET WRITTEN/.test(alerts[0].title));
  }
  // Absent from the primary means we know nothing — even if the backup happens
  // to hold an old copy, that says nothing about whether the mirror still runs.
  {
    const db = fakeDb();
    const alerts = [];
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW,
      heartbeat: hb(null, NOW.getTime() - 200 * HOUR_MS),
      alert: async (a) => alerts.push(a),
    });
    ok("a stale backup copy with no primary heartbeat is still 'awaiting'",
      res.status === STORAGE_BACKUP_STATUS.AWAITING && alerts[0].severity === "warning");
  }

  // ── the lookup itself failed → error, never a false verdict ──────────────
  {
    const db = fakeDb();
    const alerts = [];
    const heartbeat = async () => { throw new Error("PERMISSION_DENIED reading bucket"); };
    const res = await runStorageBackupCheck({
      db, env: configured, now: NOW, heartbeat, alert: async (a) => alerts.push(a),
    });
    ok("a read failure is reported, not thrown", res.status === STORAGE_BACKUP_STATUS.ERROR);
    ok("a read failure alerts ops (health unknown)",
      alerts.length === 1 && /ERRORED/.test(alerts[0].title));
    ok("the error message is recorded",
      db.writes.some((x) => /PERMISSION_DENIED/.test(x.data.error || "")));
  }

  // ── heartbeat I/O: the write must OVERWRITE a fixed path ────────────────
  // A dated path would leave yesterday's object behind and give the mirror
  // a brand-new object each night rather than a changed one — which works, but
  // accumulates forever and makes the check guess which date to read.
  console.log("\nstorageBackup (heartbeat I/O)");
  {
    const saved = [];
    adminStub.__bucket = (name) => ({
      __name: name,
      file: (path) => ({
        save: async (body, opts) => saved.push({name, path, body, opts}),
      }),
    });
    const res = await writeStorageBackupHeartbeat({now: new Date(NOW_MS), correlationId: "cid-9"});
    ok("the heartbeat is written to the fixed path", res.path === HEARTBEAT_PATH);
    ok("it goes to the DEFAULT (primary) bucket, not the backup",
      saved.length === 1 && saved[0].name === undefined);
    ok("the body is the self-describing JSON", /safe to delete/i.test(saved[0].body));
    ok("it is never cached (a cached mtime is the wrong mtime)",
      saved[0].opts.metadata.cacheControl === "no-store");
  }
  {
    adminStub.__bucket = () => ({
      file: () => ({getMetadata: async () => [{updated: "2030-01-02T02:00:00Z"}]}),
    });
    ok("a present heartbeat reports its mtime",
      (await probeHeartbeat("b")) === Date.parse("2030-01-02T02:00:00Z"));
  }
  {
    const notFound = Object.assign(new Error("No such object"), {code: 404});
    adminStub.__bucket = () => ({file: () => ({getMetadata: async () => { throw notFound; }})});
    ok("an absent heartbeat is null, not an error", (await probeHeartbeat("b")) === null);
  }
  {
    // "Could not look" must never be reported as "not there" — that would turn
    // a permissions failure into a confident verdict about the mirror.
    const denied = Object.assign(new Error("PERMISSION_DENIED"), {code: 403});
    adminStub.__bucket = () => ({file: () => ({getMetadata: async () => { throw denied; }})});
    let threw = false;
    try { await probeHeartbeat("b"); } catch (_e) { threw = true; }
    ok("a read failure throws rather than reporting absence", threw);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
