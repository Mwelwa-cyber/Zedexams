/**
 * Pure helpers for the Firebase Storage backup HEALTH CHECK (DR-003). No
 * firebase-admin / firebase-functions deps so they test under plain `node`
 * (the *Core.js split, same as firestoreBackupCore / metaWhatsAppCore).
 *
 * Why a health check and not a copy loop: the Firestore export (DR-001) covers
 * Firestore only — generated images, uploads, exports and past papers in the
 * Storage bucket have NO backup, and a delete (accidental or malicious) is
 * unrecoverable. The correct fix is infrastructure the operator provisions
 * once: Object Versioning on the primary bucket + a scheduled cross-region
 * mirror (Storage Transfer Service). A Cloud Function copying the whole bucket
 * object-by-object every day would be the wrong architecture (cost, timeouts,
 * scale). What CODE adds is what closes the actual risk — making that mirror
 * VERIFIABLE: a daily check that the backup bucket received recent objects, so
 * a silently-broken mirror alerts instead of being discovered during a
 * disaster. These helpers own the two decisions worth pinning in tests: how the
 * backup destination is resolved from config, and how "fresh / stale / empty"
 * is decided from the newest backed-up object's timestamp.
 */

const HOUR_MS = 60 * 60 * 1000;

// How old the MIRRORED HEARTBEAT may be before the mirror counts as stopped.
// Tunable via STORAGE_BACKUP_MAX_AGE_HOURS.
//
// This was 26 and that was wrong — a number that outlived the signal it was
// calibrated for. When freshness came from source-object churn, a healthy age
// sat just under 24h and 26 was a sensible two-hour grace. The heartbeat
// collapsed a healthy age to ~1.5h, and nobody moved the threshold.
//
// Derivation, from the fixed schedule (heartbeat 23:30 UTC → transfer 00:30 →
// check 02:00). The age signal is BIMODAL, not continuous: either the transfer
// landed before the check, in which case age ≤ 1.5h, or it did not, in which
// case the newest copy is the PREVIOUS day's and age is ~25.5h. There is
// nothing in between, so the threshold's only job is to cut that gap:
//
//   healthy night   age ≈ 1.45h
//   one missed night age ≈ 25.45h   ← 26 called this FRESH, missing by 33 min
//   two missed nights age ≈ 49.45h
//
// 12h sits ~8× above the healthy maximum and ~2× below one missed night, so a
// single missed transfer alerts the next morning instead of the one after.
//
// NOTE the constraint this does NOT relax: the transfer must finish before the
// 02:00 check — a 1.5h budget — and no threshold changes that, because a
// transfer still running at check time leaves yesterday's copy as the newest.
// Today's transfer takes ~3 minutes (a 30× margin). If the bucket ever grows
// enough for that to tighten, the fix is to move the CHECK later, not to raise
// this number: raising it past ~25.4h re-hides a fully missed night.
const DEFAULT_MAX_AGE_HOURS = 12;

// How far the backup's copy may trail the PRIMARY's before the mirror counts as
// stopped — a second, independent threshold, and it must not be folded back
// into the one above.
//
// The reason is arithmetic, not taste. lagMs = max(0, primary − backup) and
// ageMs = max(0, now − backup); the primary heartbeat is always a past write,
// so primary ≤ now and therefore lagMs ≤ ageMs, ALWAYS. Compare both against
// the same constant and `lag > T` implies `age > T` — the lag test can never
// fire on its own, the `||` collapses to the age test, and the independent
// signal is decorative. That was the state of this file for one commit: with
// the old 26h in place a missed night read age 25.45h and lag 22.95h, both
// under, both false, FRESH — the original bug, unmodified, with lag "voting".
//
// A separate constant works because healthy lag is not merely small, it is
// EXACTLY ZERO every night: the backup's copy is written after the primary
// write it carries, so the subtraction goes negative and clamps. The only way
// healthy lag rises is scheduler jitter pushing the 23:30 write past the 00:30
// transfer, which tops out at ~1.5h even if the write slips all the way to the
// 02:00 check. 6h leaves 4× headroom over that and still fires 3.8× under a
// missed night's ~23h — at any age threshold anyone might set.
const DEFAULT_MAX_LAG_HOURS = 6;

/**
 * Normalize the configured Storage backup bucket to a BARE bucket name (the
 * shape admin.storage().bucket(name) wants). Accepts "bucket-name" or
 * "gs://bucket-name" (optional trailing slash). Returns null when unset/blank
 * or syntactically invalid — null means "Storage backup not configured", which
 * the checker treats as misconfigured-in-prod / skip-in-dev, never a throw, so
 * deploying before the mirror exists is safe.
 *
 * @param {string|undefined|null} raw
 * @returns {string|null}
 */
function resolveStorageBackupBucket(raw) {
  const trimmed = String(raw == null ? "" : raw).trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const bare = trimmed.replace(/^gs:\/\//, "");
  // GCS bucket names: lowercase letters, digits, dashes, underscores, dots.
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bare)) return null;
  return bare;
}

// The hard ceiling on the age threshold, enforced at runtime rather than
// merely documented.
//
// Above ~25.4h an age test can no longer see a fully missed night (the newest
// copy is the previous day's, so age reads ~25.45h) — and while the LAG test
// still catches that case independently, there is one verdict lag cannot reach:
// `heartbeat-writer-stopped` is DEFINED by lag being zero, so age is its only
// detector. Set the ceiling above 25.4h and a heartbeat writer dead for four
// days reports `fresh` at age 97h, with nothing to contradict it.
//
// A test bounded DEFAULT_MAX_AGE_HOURS, which protected the compiled-in value
// and nothing else: STORAGE_BACKUP_MAX_AGE_HOURS is parsed straight from the
// environment, so `=1000` reached production unchecked. A knob that can
// silently disable a detector is not a knob worth having, so this clamps.
// 24h is a clean day, safely under the 25.4h cliff, and still detects a
// stopped writer after one missed nightly write.
const MAX_SAFE_AGE_HOURS = 24;

/**
 * Resolve the maxAge threshold (ms) from an hours value, falling back to the
 * default when unset/invalid/non-positive and CLAMPING to MAX_SAFE_AGE_HOURS.
 * The clamp is silent in the return value but not in practice: the check
 * records the resolved `maxAgeHours` on opsStorageBackups/{date}, so an
 * operator who sets 1000 sees 24 there — the number actually used. Pure.
 *
 * @param {string|number|undefined} rawHours
 * @returns {number}
 */
function resolveMaxAgeMs(rawHours) {
  const n = parseFloat(rawHours);
  const hours = Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_HOURS;
  return Math.min(hours, MAX_SAFE_AGE_HOURS) * HOUR_MS;
}

module.exports = {
  HOUR_MS,
  DEFAULT_MAX_AGE_HOURS,
  DEFAULT_MAX_LAG_HOURS,
  MAX_SAFE_AGE_HOURS,
  resolveStorageBackupBucket,
  resolveMaxAgeMs,
};
