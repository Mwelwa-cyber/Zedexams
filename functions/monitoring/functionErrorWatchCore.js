"use strict";

/**
 * Cloud Functions error monitoring — the DECISIONS, with no I/O.
 *
 * ## Why this exists
 *
 * On 2026-08-09 `apiTrackVisit` produced 80 ERRORs in two hours — 100% of the
 * server-side error volume — and nobody knew. Sentry reported **zero** across
 * the same window, correctly: `Sentry.init` lives only in `src/utils/sentry.js`
 * and nothing under `functions/` references it, so Sentry is frontend telemetry
 * and cannot observe a Cloud Function failing. The errors were found by reading
 * Cloud Logging by hand, during an unrelated post-deploy check.
 *
 * "We would have noticed" was not true, and this module is the part that makes
 * it true. Phase 5's Batch 2 is paused until it works
 * (`docs/phase5-plan.md`) — migrating more Functions before we can SEE
 * Functions fail is ordering the work backwards.
 *
 * ## Two alert classes, deliberately different
 *
 * **OOM / memory-limit → immediate, on a single occurrence.** A function that
 * exceeds its memory limit is not degraded, it is dead: the platform kills the
 * instance and the caller gets a 500 the handler's own `catch` never sees. One
 * is worth waking someone for, and waiting for a "rate" to build would have
 * delayed the apiTrackVisit alert by hours.
 *
 * **Everything else → sustained rate, grouped by function.** A single 500 is
 * normal operations. What matters is one function failing repeatedly, which is
 * why the count is per-function rather than global: 80 errors spread across 40
 * functions is a bad afternoon, 80 from one function is a broken function, and
 * a global threshold cannot tell those apart.
 *
 * ## Alerting must not become the next thing nobody reads
 *
 * Every alert is deduplicated by a per-function cooldown, and the sustained
 * class additionally requires the function to be elevated across CONSECUTIVE
 * windows — so a one-off spike during a deploy does not page anyone, while a
 * function that is genuinely broken keeps saying so until it stops.
 *
 * Pure: no firebase-admin, no firebase-functions, no network. Every input is an
 * argument, `now` included, so the windows and cooldowns are testable without
 * waiting for time to pass (`functionErrorWatchCore.test.js`).
 */

/**
 * Substrings that mean "the platform killed this instance for memory".
 *
 * Pattern matching on a log message is fragile, and this list is the fragile
 * part of the module — a wording change upstream makes an OOM look like an
 * ordinary error, which downgrades it from immediate to rate-based rather than
 * losing it entirely. That is the reason the sustained class exists as a
 * backstop, and the reason this list is exported: a test pins the exact string
 * Google emitted on 2026-08-09, so a silent regression here is visible.
 */
const OOM_PATTERNS = Object.freeze([
  "memory limit of",
  "exceeded memory limit",
  "ran out of memory",
  "out of memory",
  "oom",
]);

const DEFAULTS = Object.freeze({
  /** Errors from ONE function within a window before it counts as elevated. */
  sustainedThreshold: 10,
  /** Consecutive elevated windows before the sustained alert fires. */
  sustainedWindows: 2,
  /** Minutes before the same function may raise the same class again. */
  cooldownMinutes: 60,
});

/** Trim + lowercase, tolerating a missing/odd value. */
const lower = (v) => String(v ?? "").toLowerCase();

/**
 * Does this log entry describe a memory kill?
 *
 * @param {{message?: string}} entry
 * @return {boolean}
 */
function isOomEntry(entry) {
  const haystack = lower(entry?.message);
  if (!haystack) return false;
  return OOM_PATTERNS.some((p) => haystack.includes(p));
}

/**
 * Group entries by the function they came from.
 *
 * An entry with no resolvable function name is counted under `"(unknown)"`
 * rather than dropped. Dropping it would mean an error we cannot attribute is
 * an error we never mention — the failure mode this whole module exists to
 * correct.
 *
 * @param {Array<{functionName?: string}>} entries
 * @return {Map<string, Array<object>>}
 */
function groupByFunction(entries) {
  const out = new Map();
  for (const entry of entries ?? []) {
    const name = String(entry?.functionName || "").trim() || "(unknown)";
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(entry);
  }
  return out;
}

/** Has `cooldownMinutes` passed since `lastAt`? Missing/invalid = yes. */
function cooledDown(lastAt, now, cooldownMinutes) {
  const last = Number(lastAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  return now - last >= cooldownMinutes * 60_000;
}

/**
 * Decide what to alert on, and what the next state should be.
 *
 * State is carried between runs rather than recomputed, because "elevated for
 * two consecutive windows" and "already alerted about this" are facts about
 * previous runs that no single query of the last N minutes can recover.
 *
 * @param {object} input
 * @param {Array<object>} input.entries   Error entries in this window.
 * @param {object} [input.state]          Previous state (from Firestore).
 * @param {number} input.now              Epoch ms.
 * @param {object} [input.config]         Threshold overrides.
 * @return {{alerts: Array<object>, nextState: object, summary: object}}
 */
function decideAlerts({entries = [], state = {}, now, config = {}} = {}) {
  const cfg = {...DEFAULTS, ...config};
  if (!Number.isFinite(now)) throw new Error("now (epoch ms) is required");

  const previous = state?.functions ?? {};
  const grouped = groupByFunction(entries);
  const alerts = [];
  const nextFunctions = {};

  for (const [name, group] of grouped) {
    const prev = previous[name] ?? {};
    const oomEntries = group.filter(isOomEntry);
    const elevated = group.length >= cfg.sustainedThreshold;
    const consecutive = elevated ? Number(prev.consecutiveElevatedWindows ?? 0) + 1 : 0;

    const next = {
      consecutiveElevatedWindows: consecutive,
      lastSeenErrorCount: group.length,
      lastOomAlertAt: prev.lastOomAlertAt ?? null,
      lastSustainedAlertAt: prev.lastSustainedAlertAt ?? null,
      alerting: Boolean(prev.alerting),
    };

    // ── Immediate: memory kill ────────────────────────────────────────
    if (oomEntries.length > 0 && cooledDown(prev.lastOomAlertAt, now, cfg.cooldownMinutes)) {
      alerts.push({
        kind: "oom",
        severity: "critical",
        functionName: name,
        count: oomEntries.length,
        sample: oomEntries[0]?.message ?? "",
      });
      next.lastOomAlertAt = now;
      next.alerting = true;
    }

    // ── Sustained: this function is failing repeatedly ────────────────
    if (
      consecutive >= cfg.sustainedWindows &&
      cooledDown(prev.lastSustainedAlertAt, now, cfg.cooldownMinutes)
    ) {
      alerts.push({
        kind: "sustained",
        severity: "warning",
        functionName: name,
        count: group.length,
        windows: consecutive,
        sample: group[0]?.message ?? "",
      });
      next.lastSustainedAlertAt = now;
      next.alerting = true;
    }

    nextFunctions[name] = next;
  }

  // ── Recovery: a function that was alerting produced nothing this run ──
  // Without this, "is it still broken?" is only answerable by going back to
  // Cloud Logging — which is the habit this module is replacing.
  for (const [name, prev] of Object.entries(previous)) {
    if (nextFunctions[name]) continue;
    if (prev?.alerting) {
      alerts.push({kind: "recovered", severity: "info", functionName: name, count: 0});
    }
    // Dropped from state entirely: it is quiet, and a quiet function needs no
    // record. Retaining it would grow the doc without bound.
  }

  return {
    alerts,
    nextState: {functions: nextFunctions, updatedAt: now},
    summary: {
      totalErrors: (entries ?? []).length,
      functionsWithErrors: grouped.size,
      oomFunctions: [...grouped].filter(([, g]) => g.some(isOomEntry)).map(([n]) => n),
    },
  };
}

/**
 * Render alerts as the `{title, lines, severity}` `sendOpsAlert` expects.
 *
 * One message per run rather than one per alert: three broken functions should
 * be one page, not three.
 *
 * @param {Array<object>} alerts
 * @param {object} summary
 * @return {{title: string, lines: string[], severity: string}|null}
 */
function buildAlertMessage(alerts, summary = {}) {
  if (!alerts?.length) return null;

  const oom = alerts.filter((a) => a.kind === "oom");
  const sustained = alerts.filter((a) => a.kind === "sustained");
  const recovered = alerts.filter((a) => a.kind === "recovered");

  const severity = oom.length ? "critical" : sustained.length ? "warning" : "info";
  const title = oom.length ?
    `Cloud Functions: ${oom.length} function(s) killed for memory` :
    sustained.length ?
      `Cloud Functions: ${sustained.length} function(s) failing repeatedly` :
      "Cloud Functions: recovered";

  const lines = [];
  for (const a of oom) {
    lines.push(`MEMORY LIMIT — ${a.functionName}: ${a.count} kill(s) this window.`);
    lines.push(`  The instance is dying before it can answer. Check its declared`);
    lines.push(`  memory against the startup cost (docs/architecture/13-cloud-functions-register.md).`);
    if (a.sample) lines.push(`  e.g. ${String(a.sample).slice(0, 200)}`);
  }
  for (const a of sustained) {
    lines.push(
      `SUSTAINED ERRORS — ${a.functionName}: ${a.count} error(s), ` +
      `elevated ${a.windows} window(s) running.`,
    );
    if (a.sample) lines.push(`  e.g. ${String(a.sample).slice(0, 200)}`);
  }
  for (const a of recovered) {
    lines.push(`RECOVERED — ${a.functionName}: no errors this window.`);
  }

  if (summary.totalErrors != null) {
    lines.push("");
    lines.push(
      `Window totals: ${summary.totalErrors} error(s) across ` +
      `${summary.functionsWithErrors} function(s).`,
    );
  }
  lines.push("Source: Cloud Logging. Sentry does not observe Cloud Functions.");

  return {title, lines, severity};
}

module.exports = {
  OOM_PATTERNS,
  DEFAULTS,
  isOomEntry,
  groupByFunction,
  decideAlerts,
  buildAlertMessage,
};
