/**
 * Pure helpers for the cross-subsystem ops dead-man's-switch (OBS-004). No
 * firebase deps so they test under plain `node` (the *Core.js split).
 *
 * The per-subsystem canaries (dailyFirestoreBackup, storageBackupCheck,
 * rateLimitHealthCheck, backupCompletionCheck) each alert when THEIR subsystem
 * is unhealthy. But none of them can alert if their OWN scheduled trigger stops
 * firing — a dead cron writes no status doc and raises no alarm, so the failure
 * is invisible. This is a dead-man's-switch: it alerts on the ABSENCE of a
 * fresh heartbeat, catching a silently-stopped scheduled job.
 *
 * Each heartbeat is a status doc the subsystem writes on every run; a doc that
 * is missing or older than its max-age means that subsystem's cron has stopped.
 */

"use strict";

const HOUR_MS = 60 * 60 * 1000;

// Timestamp fields the ops status docs write (all ISO strings). The freshest
// of whichever are present is the heartbeat time.
const TS_FIELDS = ["checkedAt", "completeTime", "completedAt", "ranAt", "startTime"];

/**
 * The registry of heartbeats the switch watches. `kind`:
 *   - 'doc'   — a single fixed status doc updated every run.
 *   - 'dated' — one doc per UTC date; the freshest recent date is the heartbeat.
 * `maxAgeHours` is how stale the freshest doc may be before the writing cron is
 * considered stopped (its own cadence + generous slack for a missed run).
 */
const HEARTBEATS = Object.freeze([
  {name: "firestore-backup", collection: "opsBackups", kind: "dated", maxAgeHours: 30,
    cron: "dailyFirestoreBackup (01:30 Lusaka)"},
  {name: "storage-backup", collection: "opsStorageBackups", kind: "dated", maxAgeHours: 30,
    cron: "storageBackupCheck (04:00 Lusaka)"},
  {name: "ratelimit-health", collection: "opsRateLimitHealth", doc: "status", kind: "doc", maxAgeHours: 4,
    cron: "rateLimitHealthCheck (hourly)"},
  // The error watch is the one heartbeat that guards a MONITOR, and it exists
  // because that monitor's healthy output is silence. functionErrorWatch speaks
  // only when it finds errors, so a run that never happens is indistinguishable
  // from a quiet window — the query was built fail-closed and the invocation
  // was left fail-open. This closes that: the watch stamps a heartbeat on every
  // completion, INCLUDING a blind one, so "no alerts" can be told apart from
  // "no runs".
  // 1h against a 5-minute cadence is deliberately generous — twelve missed runs
  // before it counts as stopped, so a single cold start or a Scheduler blip
  // never pages anyone.
  {name: "function-error-watch", collection: "opsMonitorState", doc: "functionErrorsHeartbeat",
    kind: "doc", maxAgeHours: 1, cron: "functionErrorWatch (every 5 minutes)"},
]);

/**
 * Freshest heartbeat timestamp (ms) from a status doc's known ISO fields, or
 * null when none parse. Pure.
 * @param {object|null|undefined} data
 * @returns {number|null}
 */
function docTimestampMs(data) {
  if (!data || typeof data !== "object") return null;
  let latest = null;
  for (const f of TS_FIELDS) {
    const v = data[f];
    const ms = typeof v === "string" ? Date.parse(v) : NaN;
    if (Number.isFinite(ms) && (latest == null || ms > latest)) latest = ms;
  }
  return latest;
}

/**
 * Classify one heartbeat from its freshest timestamp.
 *   - missing — no doc / no parseable timestamp (the cron has never run, or its
 *               docs vanished).
 *   - stale   — freshest doc older than maxAge (the cron has stopped firing).
 *   - fresh   — a recent heartbeat exists.
 * @returns {'missing'|'stale'|'fresh'}
 */
function classifyHeartbeat({latestTsMs, nowMs, maxAgeMs}) {
  if (latestTsMs == null || !Number.isFinite(Number(latestTsMs))) return "missing";
  return Number(nowMs) - Number(latestTsMs) > maxAgeMs ? "stale" : "fresh";
}

/**
 * Roll individual heartbeat verdicts into an overall health summary.
 * @param {Array<{name: string, status: string}>} results
 * @returns {{verdict: 'healthy'|'unhealthy', stale: string[], missing: string[], unhealthy: string[]}}
 */
function summarizeHeartbeats(results) {
  const list = Array.isArray(results) ? results : [];
  const stale = list.filter((r) => r && r.status === "stale").map((r) => r.name);
  const missing = list.filter((r) => r && r.status === "missing").map((r) => r.name);
  const unhealthy = [...missing, ...stale];
  return {verdict: unhealthy.length ? "unhealthy" : "healthy", stale, missing, unhealthy};
}

/**
 * Edge-triggered alert decision: alert only when the fleet has JUST become
 * unhealthy (onset), not on every run of an ongoing outage.
 * @param {'healthy'|'unhealthy'} current
 * @param {'healthy'|'unhealthy'|undefined|null} previous
 * @returns {boolean}
 */
function shouldAlertHeartbeat(current, previous) {
  return current === "unhealthy" && previous !== "unhealthy";
}

/** Recent UTC date-keys (today + N-1 previous days), newest first. */
function recentUtcDateKeys(now, days = 3) {
  const keys = [];
  for (let i = 0; i < Math.max(1, days); i += 1) {
    keys.push(new Date(now.getTime() - i * 24 * HOUR_MS).toISOString().slice(0, 10));
  }
  return keys;
}

module.exports = {
  HOUR_MS,
  HEARTBEATS,
  TS_FIELDS,
  docTimestampMs,
  classifyHeartbeat,
  summarizeHeartbeats,
  shouldAlertHeartbeat,
  recentUtcDateKeys,
};
