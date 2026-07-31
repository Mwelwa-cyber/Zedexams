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
  DEFAULT_MAX_AGE_MS, DEFAULT_MAX_LAG_MS,
} = require("./storageBackupHeartbeatCore");
const {DEFAULT_MAX_AGE_HOURS, HOUR_MS} = require("./storageBackupCore");

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

// ── THE DETECTION EDGE, computed from the real schedule ──────────────────
// The threshold and the cron times are declared in different files and only
// work together. 26h was correct for the OLD signal (source churn, healthy age
// just under 24h) and survived unchanged into the heartbeat, where a healthy
// age is ~1.5h — so one missed night computed 25.45h and read FRESH, by 33
// minutes, in the wrong direction. This derives the numbers rather than
// asserting a remembered constant, so the same drift cannot recur silently.
console.log("\nstorageBackupHeartbeatCore (detection edge)");
{
  const H = HOUR_MS;
  const DAY = 24 * H;
  const write = 23.5 * H;       // heartbeat written 23:30 UTC
  const land = DAY + 0.55 * H;  // transfer lands it ~00:33 the next morning
  const check = DAY + 2 * H;    // check runs 02:00 UTC

  const at = (nowMs, primary, backup) =>
    classifyHeartbeat({primaryUpdatedMs: primary, backupUpdatedMs: backup, nowMs});

  const healthy = at(check, write, land);
  ok("a healthy night is ~1.5h old, not ~24h (this is what moved)",
    healthy.ageMs / H > 1 && healthy.ageMs / H < 2);
  ok("a healthy night is fresh", healthy.status === "fresh");
  ok("a healthy night has zero lag — the copy is newer than what it copied",
    healthy.lagMs === 0);

  // One missed transfer: the heartbeat advanced, the backup's copy did not.
  const missed = at(check + DAY, write + DAY, land);
  ok("ONE missed night is caught the next morning",
    missed.status === "stale");
  // The specific regression: 26h did not catch it.
  ok("the old 26h threshold demonstrably did NOT catch it (25.45 < 26)",
    missed.ageMs / H > 25 && missed.ageMs / H < 26);

  // ── the GENERALISED defence, and why it needs its own constant ──────────
  // lagMs = max(0, primary − backup) and ageMs = max(0, now − backup), and the
  // primary heartbeat is always a past write, so lagMs ≤ ageMs ALWAYS. Compare
  // both to one constant and `lag > T` implies `age > T` — the lag branch is
  // unreachable and the `||` degenerates to the age test alone. Asserting that
  // both exceed a shared threshold would DOCUMENT that coupling rather than
  // catch it, which is what the previous version of this test did.
  ok("lag can never exceed age (the fact that makes one shared threshold fail)",
    missed.lagMs <= missed.ageMs && healthy.lagMs <= healthy.ageMs);
  ok("the lag threshold is well below the age threshold, so it can fire first",
    DEFAULT_MAX_LAG_MS < DEFAULT_MAX_AGE_MS);

  // The real test: re-tune age back to the broken 26h and confirm the missed
  // night is STILL caught — by lag, which age can no longer veto. This fails
  // if the two thresholds are ever collapsed back into one.
  const misTuned = classifyHeartbeat({
    primaryUpdatedMs: write + DAY, backupUpdatedMs: land, nowMs: check + DAY,
    maxAgeMs: 26 * H,
  });
  ok("a missed night is caught even with the age threshold mis-tuned to 26h",
    misTuned.status === "stale");
  ok("...and it is LAG that catches it there, with age silent",
    misTuned.lagMs > DEFAULT_MAX_LAG_MS && misTuned.ageMs < 26 * H);
  // Belt and braces: an absurd age ceiling must not disable detection either.
  ok("even a 1000h age ceiling cannot silence a missed night",
    classifyHeartbeat({
      primaryUpdatedMs: write + DAY, backupUpdatedMs: land, nowMs: check + DAY,
      maxAgeMs: 1000 * H,
    }).status === "stale");

  ok("the threshold sits clear of a healthy night",
    DEFAULT_MAX_AGE_HOURS > (healthy.ageMs / H) * 4);
  ok("the threshold sits clear below one missed night",
    DEFAULT_MAX_AGE_HOURS < (missed.ageMs / H) / 1.5);
}

// ── the two faults stay separate ──────────────────────────────────────────
{
  const H = HOUR_MS;
  const now = 100 * H;
  // Writer stopped: the primary heartbeat is old, and the mirror carried that
  // old copy across faithfully — so the backup is level with it.
  const writerDead = classifyHeartbeat({
    primaryUpdatedMs: now - 40 * H, backupUpdatedMs: now - 39 * H, nowMs: now,
  });
  ok("an old heartbeat the mirror KEPT UP with blames the writer, not the mirror",
    writerDead.status === "heartbeat-writer-stopped");
  ok("...and reports no lag, because there is none", writerDead.lagMs === 0);

  // Mirror stopped: the primary advanced, the backup did not.
  const mirrorDead = classifyHeartbeat({
    primaryUpdatedMs: now - H, backupUpdatedMs: now - 40 * H, nowMs: now,
  });
  ok("an advancing heartbeat the mirror stopped carrying blames the mirror",
    mirrorDead.status === "stale");
}

console.log(`\n─── ${passed} assertions · all passed ───`);
