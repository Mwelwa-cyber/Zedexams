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

// ── When the log query itself fails ────────────────────────────────────────
//
// A failed query used to page CRITICAL on the very first occurrence, whatever
// the cause. That conflated two different facts: a 403 (the service account
// lost roles/logging.viewer) is permanent and every run until someone fixes it
// is blind, while a 502 from the Logging front end is Google's load balancer
// hiccupping and is usually gone by the next request. Paging on the second kind
// trains the reader to ignore the first — the "alert nobody reads" this module
// is careful about everywhere else.
//
// So: transient failures are retried inside the run, and only page when they
// persist across BLIND_ALERT_AFTER_RUNS consecutive runs. Nothing goes unwatched
// in the meantime: the next successful run widens its query back to the last
// successful one (`querySinceMs`), so the window a transient failure skipped is
// still checked — just a few minutes late.

/** HTTP statuses that mean "try again", not "you are misconfigured". */
const TRANSIENT_STATUSES = Object.freeze([408, 429, 500, 502, 503, 504]);

const BLIND_DEFAULTS = Object.freeze({
  /** Consecutive transient-blind runs before paging (3 × 5min = 15min). */
  blindAlertAfterRuns: 3,
  /** Minutes before a continuing blind spell may page again. */
  blindCooldownMinutes: 60,
  /** Furthest back a catch-up query reaches after blind runs. */
  maxCatchUpMinutes: 60,
});

/**
 * Is this failure worth retrying / tolerating for a run or two?
 *
 * Opt-in, never assumed: only an HTTP status on the list, or a failure the
 * fetcher explicitly marked `transient` (no HTTP answer at all — reset, DNS,
 * timeout), qualifies. Anything else — 400/401/403/404, or an error nobody
 * classified — pages immediately, because an unknown failure tolerated
 * silently is exactly the false green this watch exists to prevent.
 *
 * @param {{status?: number, transient?: boolean, permanent?: boolean}} failure
 * @return {boolean}
 */
function isTransientQueryFailure(failure) {
  if (failure?.permanent) return false;
  if (failure?.transient === true) return true;
  return TRANSIENT_STATUSES.includes(Number(failure?.status));
}

/**
 * Reduce an error response body to one readable line.
 *
 * Google's front end answers a 502 with a full HTML page, which used to land
 * in the alert verbatim — a screenful of `<meta>` and inline CSS on a phone.
 * Prefer the JSON error message, then the HTML <title>, then the text with
 * tags stripped.
 *
 * @param {string} body
 * @param {number} [max]
 * @return {string}
 */
function summarizeErrorBody(body, max = 200) {
  const text = String(body ?? "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    const msg = parsed?.error?.message ?? parsed?.message;
    if (msg) return String(msg).slice(0, max);
  } catch { /* not JSON */ }
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return title[1].replace(/\s+/g, " ").trim().slice(0, max);
  return text
    .replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Decide whether a blind run pages, and what the heartbeat should remember.
 *
 * @param {object} input
 * @param {{status?: number, permanent?: boolean}} input.failure
 * @param {object} [input.heartbeat]  Previous heartbeat doc.
 * @param {number} input.now          Epoch ms.
 * @param {object} [input.config]
 * @return {{alert: boolean, transient: boolean, consecutiveBlindRuns: number,
 *   lastBlindAlertAt: number|null}}
 */
function decideBlindAlert({failure, heartbeat = {}, now, config = {}} = {}) {
  const cfg = {...BLIND_DEFAULTS, ...config};
  const transient = isTransientQueryFailure(failure);
  const consecutiveBlindRuns = Number(heartbeat?.consecutiveBlindRuns ?? 0) + 1;
  const prevAlertAt = heartbeat?.lastBlindAlertAt ?? null;
  const persisted = !transient || consecutiveBlindRuns >= cfg.blindAlertAfterRuns;
  const alert = persisted && cooledDown(prevAlertAt, now, cfg.blindCooldownMinutes);
  return {
    alert,
    transient,
    consecutiveBlindRuns,
    lastBlindAlertAt: alert ? now : (prevAlertAt ?? null),
  };
}

/**
 * Where a successful run should start reading from.
 *
 * Normally the fixed window. After blind runs, back to the last SUCCESSFUL
 * run, so what the blind runs could not read is read now — capped, so a long
 * outage does not turn into one enormous query.
 *
 * @param {object} input
 * @param {number} input.now
 * @param {number} input.windowMinutes
 * @param {number|null} [input.lastSuccessAt]
 * @param {object} [input.config]
 * @return {number} Epoch ms.
 */
function querySinceMs({now, windowMinutes, lastSuccessAt = null, config = {}} = {}) {
  const cfg = {...BLIND_DEFAULTS, ...config};
  const normal = now - windowMinutes * 60_000;
  const last = Number(lastSuccessAt);
  if (!Number.isFinite(last) || last <= 0 || last >= normal) return normal;
  return Math.max(last, now - cfg.maxCatchUpMinutes * 60_000);
}

module.exports = {
  OOM_PATTERNS,
  DEFAULTS,
  isOomEntry,
  groupByFunction,
  decideAlerts,
  buildAlertMessage,
  TRANSIENT_STATUSES,
  BLIND_DEFAULTS,
  isTransientQueryFailure,
  summarizeErrorBody,
  decideBlindAlert,
  querySinceMs,
};
