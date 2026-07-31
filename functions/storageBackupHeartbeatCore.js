/**
 * Pure helpers for the Storage-backup HEARTBEAT (DR-003). No firebase-admin /
 * firebase-functions deps so they test under plain `node` (the *Core.js split).
 *
 * WHY A HEARTBEAT AT ALL — the bug this exists to kill:
 *
 * The check used to answer "is the newest object in the backup bucket recent?"
 * and treat that as "did the mirror run?". Those are different questions, and
 * the gap between them is not theoretical. The Storage Transfer Service job
 * runs with `--overwrite-when=different`, so a night in which nothing in the
 * source changed copies NOTHING — correctly. No destination object is written,
 * the newest one keeps ageing, and once it crosses the threshold the check
 * emails `stale`: an ERROR alert about a mirror that is provably perfect.
 *
 * That is not a rare edge. On this project the source bucket routinely goes
 * 16–17 quiet hours, and gaps past the 26h default were observed on the very
 * first day of operation. Worse, it fails ASYMMETRICALLY: the day you finish
 * provisioning, every object has just been copied, so the check reads `fresh`
 * and the operator gets a false all-clear. The lying `stale` arrives a day or
 * two later, once the mirror has settled into normal no-op nights.
 *
 * The fix is to stop inferring. Each run overwrites ONE small object at a FIXED
 * path in the primary bucket. An overwrite is a change, so the mirror must copy
 * it — a no-op night becomes impossible by construction. The check then reads
 * that single object's mtime IN THE BACKUP. If it advanced, the mirror ran,
 * end to end, and we know it because the mirror carried our token across rather
 * than because a job reported success about itself.
 *
 * Three properties worth keeping:
 *   • O(1). One object, one path, one metadata read. The old scan paged through
 *     4000+ objects and still could not prove absence — see #2029's truncation
 *     handling, which this retires.
 *   • It distinguishes "the writer never ran" from "the mirror is broken".
 *     Reading the heartbeat on BOTH sides turns one ambiguous `stale` into two
 *     different faults with two different fixes.
 *   • Fixed path, not dated. A dated path leaves yesterday's object behind
 *     forever and makes the check guess which date to look for; overwriting one
 *     path means the primary's own lifecycle rule expires the superseded
 *     versions and there is exactly one thing to read.
 */

// One declaration of the threshold, imported rather than repeated. It was
// written out here as `26 * HOUR_MS` as well, so the release that mis-tuned it
// had TWO copies to get wrong — and a default only the tests reach is the copy
// nobody notices. storageBackupCore requires nothing, so there is no cycle.
const {DEFAULT_MAX_AGE_HOURS, DEFAULT_MAX_LAG_HOURS} = require("./storageBackupCore");

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_MAX_AGE_MS = DEFAULT_MAX_AGE_HOURS * HOUR_MS;
const DEFAULT_MAX_LAG_MS = DEFAULT_MAX_LAG_HOURS * HOUR_MS;

// Under `_ops/` so it sorts away from real content and is obvious in a bucket
// listing. Fixed — every write overwrites the previous one.
const HEARTBEAT_PATH = "_ops/storage-backup-heartbeat.json";

// The heartbeat must be written BEFORE the nightly transfer (00:30 UTC) so the
// mirror has something new to carry, and read AFTER it (the 04:00 Lusaka =
// 02:00 UTC check). 23:30 UTC leaves an hour on the near side.
const HEARTBEAT_WRITE_HOUR_UTC = 23;

const STORAGE_HEARTBEAT_STATUS = Object.freeze({
  // Absent from the PRIMARY: the writer cron has not run. Nothing is known
  // about the mirror yet — a brand-new deploy looks exactly like this, so it
  // must never page.
  AWAITING: "awaiting-heartbeat",
  // Present on the primary, absent from the backup: the mirror has never
  // carried it across.
  MISSING_AT_BACKUP: "empty",
  // Present on both, but the primary's copy has itself stopped advancing while
  // the mirror is demonstrably caught up. The WRITER stopped, not the mirror —
  // a different cron, a different fix. Without this the check sends someone to
  // debug a transfer job that is working perfectly.
  WRITER_STOPPED: "heartbeat-writer-stopped",
  STALE: "stale",
  FRESH: "fresh",
});

/**
 * Decide mirror health from the heartbeat as seen on BOTH sides. Pure — this is
 * the whole verdict, so it is the thing worth testing exhaustively.
 *
 * The asymmetry is deliberate: a heartbeat missing from the PRIMARY says
 * nothing about the mirror (our writer failed, not their copier), so it is
 * never an error about the backup. A heartbeat present on the primary but
 * missing or old at the backup is the mirror failing to do its one job.
 *
 * @param {object} p
 * @param {number|null} p.primaryUpdatedMs heartbeat mtime on the primary, or null
 * @param {number|null} p.backupUpdatedMs  heartbeat mtime in the backup, or null
 * @param {number} p.nowMs
 * @param {number} [p.maxAgeMs]
 * @returns {{status: string, ageMs: number|null, lagMs: number|null}}
 */
function classifyHeartbeat({
  primaryUpdatedMs, backupUpdatedMs, nowMs,
  maxAgeMs = DEFAULT_MAX_AGE_MS, maxLagMs = DEFAULT_MAX_LAG_MS,
}) {
  // `Number(null)` is 0 — finite, and a perfectly plausible epoch timestamp —
  // so absence must be tested BEFORE coercion or a missing heartbeat reads as
  // 1970 and every verdict becomes `stale`.
  const ms = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const primary = ms(primaryUpdatedMs);
  const backup = ms(backupUpdatedMs);

  if (primary == null) {
    return {status: STORAGE_HEARTBEAT_STATUS.AWAITING, ageMs: null, lagMs: null};
  }
  if (backup == null) {
    return {status: STORAGE_HEARTBEAT_STATUS.MISSING_AT_BACKUP, ageMs: null, lagMs: null};
  }

  const ageMs = Math.max(0, Number(nowMs) - backup);
  // How far the backup's copy trails the primary's — the mirror's actual lag.
  // Zero in healthy operation, because the backup copy is written AFTER the
  // primary write it carries.
  const lagMs = Math.max(0, primary - backup);

  // TWO signals against TWO thresholds, and the second threshold is what makes
  // the second signal real.
  //
  //   ageMs — how long since ANY copy landed. Catches a stopped transfer, but
  //           only via wall-clock, so it depends on maxAgeMs being calibrated
  //           against the cron schedule. It was not, for one release: 26h let
  //           a missed night read as fresh by 33 minutes.
  //   lagMs — whether the backup is behind the SOURCE. Schedule-independent:
  //           the primary heartbeat advanced and the backup's copy did not.
  //
  // Either alone is enough to call the mirror stopped — but ONLY because they
  // are compared against different constants. lagMs ≤ ageMs always (primary is
  // a past write, so primary ≤ now), so sharing one threshold makes
  // `lag > T` ⟹ `age > T`: the lag branch becomes unreachable and the `||`
  // silently degenerates to the age test. The lag threshold is much smaller
  // precisely so it can fire while age is still under a mis-tuned ceiling.
  const tooOld = ageMs > maxAgeMs;
  const tooFarBehind = lagMs > maxLagMs;

  if (tooOld || tooFarBehind) {
    // A stale age with the mirror CAUGHT UP is not the mirror's failure: the
    // primary's own heartbeat stopped advancing, so the copy is old because
    // the original is. Blaming the transfer here sends someone to the wrong
    // system — and the right one, the writer cron, keeps not running.
    if (tooOld && !tooFarBehind) {
      return {status: STORAGE_HEARTBEAT_STATUS.WRITER_STOPPED, ageMs, lagMs};
    }
    return {status: STORAGE_HEARTBEAT_STATUS.STALE, ageMs, lagMs};
  }
  return {status: STORAGE_HEARTBEAT_STATUS.FRESH, ageMs, lagMs};
}

/**
 * The heartbeat object's body. Human-readable on purpose — someone will find
 * this file in a bucket listing and need to know what it is and whether it is
 * safe to delete. Pure.
 *
 * @param {Date} now
 * @param {string} correlationId
 * @returns {string}
 */
function buildHeartbeatBody(now, correlationId = "") {
  return `${JSON.stringify({
    what: "ZedExams Storage backup heartbeat (DR-003)",
    why: "Overwritten nightly so the Storage Transfer Service mirror always has " +
      "a changed object to copy. storageBackupCheck reads this object's mtime " +
      "in the BACKUP bucket to prove the mirror ran. Safe to delete; it will " +
      "be recreated on the next run, and its absence is reported as " +
      "'awaiting-heartbeat', never as a mirror failure.",
    writtenAt: now.toISOString(),
    correlationId,
  }, null, 2)}\n`;
}

module.exports = {
  HOUR_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_LAG_MS,
  HEARTBEAT_PATH,
  HEARTBEAT_WRITE_HOUR_UTC,
  STORAGE_HEARTBEAT_STATUS,
  classifyHeartbeat,
  buildHeartbeatBody,
};
