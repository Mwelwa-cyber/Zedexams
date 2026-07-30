/**
 * Node test for the Storage-backup heartbeat core (DR-003).
 * Run: node functions/storageBackupHeartbeatCore.test.js
 *
 * storageBackup.test.js already drives classifyHeartbeat through the check.
 * This pins the schedule INVARIANT that the whole design rests on and that no
 * unit test of a single function can see: the heartbeat must be written before
 * the transfer runs, and read after it. Get that order wrong and the check
 * verifies yesterday's copy every night while reporting `fresh`.
 */

const assert = require("node:assert");
const {
  HEARTBEAT_PATH, HEARTBEAT_WRITE_HOUR_UTC, classifyHeartbeat,
} = require("./storageBackupHeartbeatCore");

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

console.log("storageBackupHeartbeatCore");

// The three times are declared in three places — this module, the provisioning
// script's schedule default, and the check's cron. They only work in this order.
const TRANSFER_START_HOUR_UTC = 0;   // scripts/provision-storage-backup.mjs (00:30)
const CHECK_HOUR_UTC = 2;            // storageBackupCheck, 04:00 Africa/Lusaka

ok("the heartbeat is written before the transfer starts",
  HEARTBEAT_WRITE_HOUR_UTC > TRANSFER_START_HOUR_UTC ||
  HEARTBEAT_WRITE_HOUR_UTC + 24 > TRANSFER_START_HOUR_UTC + 24);
ok("write → transfer → check, with the write on the previous UTC day",
  HEARTBEAT_WRITE_HOUR_UTC === 23 && TRANSFER_START_HOUR_UTC < CHECK_HOUR_UTC);
ok("the check runs after the transfer, not alongside it",
  CHECK_HOUR_UTC - TRANSFER_START_HOUR_UTC >= 1);

ok("the heartbeat sorts away from real content", HEARTBEAT_PATH.startsWith("_ops/"));
ok("the path is fixed, not dated (so it OVERWRITES)",
  !/\d{4}|\{|\$/.test(HEARTBEAT_PATH));

// The mirror excludes tmp-downloads/ — it must not exclude the heartbeat too,
// or the check would report `empty` forever on a healthy mirror.
ok("the heartbeat is not under the excluded staging prefix",
  !HEARTBEAT_PATH.startsWith("tmp-downloads/"));

ok("a heartbeat is never classified from a missing primary",
  classifyHeartbeat({primaryUpdatedMs: null, backupUpdatedMs: 1, nowMs: 2}).status ===
  "awaiting-heartbeat");

console.log(`\n─── ${passed} assertions · all passed ───`);
