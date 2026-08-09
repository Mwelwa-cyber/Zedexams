/**
 * Sift — the pure half of the server-side error watcher.
 *
 * ## Why this exists
 *
 * `apiTrackVisit` burned 80 ERRORs in a 2h window — 100% of the server-side
 * error volume in that period, "Memory limit of 128 MiB exceeded", POST 500s
 * and a 503 — and nobody knew until someone happened to open Cloud Logging
 * (#2230). The memory bug itself is fixed (#2231, #2233); this module is the
 * other half of that issue: making a Cloud Function burning 40 errors/hour
 * SURFACE, instead of waiting to be noticed.
 *
 * ## Why not Sentry
 *
 * `Sentry.init` lives only in `src/utils/sentry.js` — it is frontend telemetry
 * and nothing under `functions/` references it. The tempting fix is to wire it
 * into the backend too, and it would not have caught this: **an OOM kill is a
 * platform action, not a thrown error.** The container is terminated; no
 * in-process handler, `beforeSend`, or `process.on('uncaughtException')` runs,
 * because there is no process left to run it. The same is true of a hard
 * timeout kill and of a 503 from an instance that never finished starting —
 * which between them are the whole of what took apiTrackVisit down.
 *
 * Only the platform's own log stream sees those, so that is what Sift reads.
 * (A second reason, specific to this repo: every v2 instance already loads the
 * whole of `functions/index.js` at ~148 MiB RSS. Adding an always-on APM agent
 * to all 191 exports raises the startup cost that caused this bug in the first
 * place.)
 *
 * ## The rule this module is built around
 *
 * **A query failure is never reported as "no errors."** The issue's own
 * diagnosis was that "Sentry is clean, therefore the backend is healthy" is an
 * unsupported inference — a tool that cannot see a failure reporting silence.
 * Reproducing that shape here would be the same bug in a new costume, so
 * `summarizeErrorEntries` is only ever handed entries that were actually read,
 * and an unreadable window is its own alertable state (`unavailable`) rather
 * than a green one. See `assessErrors`.
 *
 * No I/O, no SDKs — unit-tested under plain `node` (siftCore.test.js).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The window Sift reads on each run. Deliberately WIDER than the hourly
 * schedule (75 min vs 60) so a slightly late or slightly early run cannot open
 * a gap between windows that an error falls through. The cost of the overlap is
 * that a burst near a window edge can be counted twice; the cost of a gap is a
 * missed outage, so the overlap is the right way to be wrong.
 */
const WINDOW_MS = 75 * MINUTE;

/**
 * Alert thresholds, per window.
 *
 * `WARN_PER_FUNCTION` is 5 rather than 1 because a single ERROR line is normal
 * background noise on a platform this size (a dropped connection, one bad
 * request body) and an alert that fires on noise is an alert that gets muted.
 * 40/hour — what apiTrackVisit was doing — clears every one of these by a wide
 * margin, and so does anything remotely like it.
 */
const WARN_PER_FUNCTION = 5;
const WARN_TOTAL = 15;
const CRITICAL_PER_FUNCTION = 25;

/** Re-alert about an unresolved problem at most this often. */
const NOTIFY_COOLDOWN_MS = 24 * HOUR;

/** Ceilings so one bad hour cannot produce an unbounded alert or rollup. */
const MAX_OFFENDERS = 10;
const MAX_SAMPLE_CHARS = 300;

/**
 * Failure classes, most severe first. `test` runs against the entry's message
 * text; the FIRST match wins, so order is the classification.
 *
 * `memory_exceeded` and `startup_failure` are marked `platform: true` — they are
 * the classes an in-process error reporter structurally cannot observe, and the
 * ones that mean the instance could not run rather than that a request went
 * wrong. Any of them present makes the finding critical regardless of count,
 * because "the function cannot start" does not become more true at 25/hour than
 * it is at 3.
 */
const FAILURE_CLASSES = [
  {
    kind: "memory_exceeded",
    platform: true,
    test: /memory limit of .* exceeded|exceeded memory limit|out of memory|OOMKilled/i,
  },
  {
    kind: "startup_failure",
    platform: true,
    test: /container.*failed to start|failed to start and then listen|the request was aborted because there was no available instance|503/i,
  },
  {
    kind: "timeout",
    platform: true,
    test: /finished with status: ?'?timeout|function execution took .* exceeded|deadline.exceeded|context deadline exceeded/i,
  },
  {
    kind: "crash",
    test: /terminated.*signal|segmentation fault|process exited with|unhandled (promise )?rejection|uncaught exception/i,
  },
  {kind: "exception", test: /\b(TypeError|ReferenceError|RangeError|SyntaxError)\b|^Error:| Error: /},
];

/** Anything unmatched. Kept as a named constant so tests can assert on it. */
const DEFAULT_KIND = "error";

/**
 * Classify one message into a failure class.
 * @param {string} message
 * @returns {string} one of FAILURE_CLASSES' kinds, or DEFAULT_KIND
 */
function classifyMessage(message) {
  const text = String(message || "");
  for (const c of FAILURE_CLASSES) {
    if (c.test.test(text)) return c.kind;
  }
  return DEFAULT_KIND;
}

/** True if `kind` is a class an in-process reporter could not have seen. */
function isPlatformKind(kind) {
  const c = FAILURE_CLASSES.find((f) => f.kind === kind);
  return Boolean(c && c.platform);
}

/**
 * The Cloud Logging filter for one window.
 *
 * Both resource types, because this project deploys both Cloud Functions
 * generations: v2 functions ARE Cloud Run services (`cloud_run_revision`) and
 * the v1 auth trigger in `storageCleanup/onUserDeleted.js` is a
 * `cloud_function`. Reading only the v2 type would make a whole SDK generation
 * invisible — the exact blind spot that let the original bug through the
 * frozen-surface manifest (#2233).
 *
 * @param {{sinceIso: string}} args
 * @returns {string} a Cloud Logging v2 filter expression
 */
function buildLogFilter({sinceIso}) {
  return [
    "severity>=ERROR",
    `timestamp>="${sinceIso}"`,
    "(resource.type=\"cloud_run_revision\" OR resource.type=\"cloud_function\")",
  ].join("\n");
}

/**
 * The function name an entry belongs to.
 *
 * v2 (Cloud Run) labels it `service_name` and LOWERCASES it — which is why the
 * issue is titled `apitrackvisit` and the export is `apiTrackVisit`. The name
 * is passed through as the platform reports it rather than being prettied up:
 * it is what an operator will type into Cloud Logging to see the same rows.
 *
 * @param {object} entry a Cloud Logging LogEntry
 * @returns {string} the function/service name, or "" when unattributable
 */
function functionNameOf(entry) {
  const labels = (entry && entry.resource && entry.resource.labels) || {};
  return String(labels.function_name || labels.service_name || "").trim();
}

/**
 * Flatten a LogEntry's payload to the one message line we classify and sample.
 * Cloud Logging delivers three payload shapes and a real error stream carries
 * all three, so reading only `textPayload` would silently drop the structured
 * ones (which is most of what this codebase logs — see `logVisit`).
 *
 * @param {object} entry
 * @returns {string}
 */
function messageOf(entry) {
  if (!entry) return "";
  if (typeof entry.textPayload === "string") return entry.textPayload;
  const json = entry.jsonPayload;
  if (json && typeof json === "object") {
    const m = json.message || json.msg || json.error || json.event;
    if (typeof m === "string") return m;
    try {
      return JSON.stringify(json);
    } catch (_e) {
      return "";
    }
  }
  const proto = entry.protoPayload;
  if (proto && typeof proto === "object" && proto.status &&
      typeof proto.status.message === "string") {
    return proto.status.message;
  }
  return "";
}

/**
 * Group raw log entries into a per-function summary.
 *
 * ONLY ever called with entries that were actually read — an unreadable window
 * takes the `unavailable` path in `assessErrors` instead, so an empty summary
 * here always means "we looked and there was nothing", never "we could not
 * look".
 *
 * @param {object[]} entries Cloud Logging LogEntry objects
 * @returns {{total: number, functions: object[], unattributed: number}}
 */
function summarizeErrorEntries(entries = []) {
  const byName = new Map();
  let unattributed = 0;

  for (const entry of entries) {
    const name = functionNameOf(entry);
    if (!name) {
      unattributed += 1;
      continue;
    }
    const message = messageOf(entry);
    const kind = classifyMessage(message);

    let row = byName.get(name);
    if (!row) {
      row = {name, count: 0, kinds: {}, sample: "", firstSeen: null, lastSeen: null};
      byName.set(name, row);
    }
    row.count += 1;
    row.kinds[kind] = (row.kinds[kind] || 0) + 1;
    // Keep the sample from the most severe class seen so far, so the alert
    // quotes the OOM line rather than whichever request happened to be last.
    if (!row.sample || (isPlatformKind(kind) && !isPlatformKind(row.sampleKind))) {
      row.sample = message.slice(0, MAX_SAMPLE_CHARS);
      row.sampleKind = kind;
    }
    const ts = entry && entry.timestamp;
    if (ts) {
      if (!row.firstSeen || ts < row.firstSeen) row.firstSeen = ts;
      if (!row.lastSeen || ts > row.lastSeen) row.lastSeen = ts;
    }
  }

  const functions = [...byName.values()].sort((a, b) => b.count - a.count);
  return {
    total: entries.length,
    functions,
    unattributed,
  };
}

/**
 * Decide whether a summary is worth waking someone for, and at what severity.
 *
 * @param {object} args
 * @param {object} [args.summary]   from summarizeErrorEntries
 * @param {string} [args.unavailable] reason the log read failed, if it did
 * @returns {{ok: boolean, severity: string, offenders: object[],
 *   unavailable: string|null, total: number}}
 */
function assessErrors({summary, unavailable = null} = {}) {
  // A window we could not read is NOT a quiet window. Reporting it as healthy
  // is precisely the inference this whole module exists to stop being made.
  if (unavailable) {
    return {
      ok: false,
      severity: "warning",
      offenders: [],
      unavailable: String(unavailable).slice(0, MAX_SAMPLE_CHARS),
      total: 0,
    };
  }

  const s = summary || {total: 0, functions: [], unattributed: 0};
  const offenders = [];

  for (const fn of s.functions) {
    const kinds = Object.keys(fn.kinds || {});
    const platformKinds = kinds.filter(isPlatformKind);
    const critical = fn.count >= CRITICAL_PER_FUNCTION || platformKinds.length > 0;
    if (!critical && fn.count < WARN_PER_FUNCTION) continue;
    offenders.push({
      ...fn,
      severity: critical ? "critical" : "warning",
      platformKinds,
    });
  }

  const trimmed = offenders.slice(0, MAX_OFFENDERS);
  const anyCritical = trimmed.some((o) => o.severity === "critical");
  // A total over the ceiling matters even when it is spread thinly enough that
  // no single function trips its own threshold: something systemic is wrong.
  const noisyTotal = s.total >= WARN_TOTAL;

  if (!trimmed.length && !noisyTotal) {
    return {ok: true, severity: "info", offenders: [], unavailable: null, total: s.total};
  }

  return {
    ok: false,
    severity: anyCritical ? "critical" : "warning",
    offenders: trimmed,
    unavailable: null,
    total: s.total,
  };
}

/**
 * Stable dedupe key for one offender. Keyed on the function AND its failure
 * classes, so a function that starts failing a NEW way re-alerts instead of
 * being suppressed by the cooldown of the old problem.
 *
 * @param {{name: string, kinds?: object}} offender
 * @returns {string}
 */
function offenderKey(offender) {
  const kinds = Object.keys((offender && offender.kinds) || {}).sort().join("+");
  return `${(offender && offender.name) || "unknown"}:${kinds || DEFAULT_KIND}`;
}

/**
 * Should this finding be sent, given what we already sent?
 *
 * Cooldown so an unresolved problem is raised at most once a day (Vigil's rule),
 * with ONE exception: an escalation from warning to critical always gets
 * through. Suppressing "this got much worse" because we mentioned "this is a bit
 * off" yesterday would turn the dedupe into a way of losing the alert that
 * actually mattered.
 *
 * @param {object} args
 * @param {string} args.severity        the finding's severity now
 * @param {object} [args.previous]      {severity, notifiedAtMs} from last send
 * @param {number} args.now
 * @param {number} [args.cooldownMs]
 * @returns {{notify: boolean, reason: string}}
 */
function shouldNotify({severity, previous, now, cooldownMs = NOTIFY_COOLDOWN_MS}) {
  if (!previous || !previous.notifiedAtMs) return {notify: true, reason: "first-seen"};
  if (severity === "critical" && previous.severity !== "critical") {
    return {notify: true, reason: "escalated"};
  }
  const age = now - Number(previous.notifiedAtMs || 0);
  if (age >= cooldownMs) return {notify: true, reason: "cooldown-elapsed"};
  return {notify: false, reason: "suppressed-within-cooldown"};
}

/**
 * The human-readable alert body. Kept pure so the wording is testable — an ops
 * alert nobody can act on from the message alone costs a Cloud Logging session
 * per page.
 *
 * @param {object} args
 * @param {object} args.assessment  from assessErrors
 * @param {number} args.windowMs
 * @param {string} [args.projectId]
 * @returns {{title: string, lines: string[]}}
 */
function buildAlert({assessment, windowMs = WINDOW_MS, projectId = ""} = {}) {
  const mins = Math.round(windowMs / MINUTE);

  if (assessment.unavailable) {
    return {
      title: "Server error watch could not read Cloud Logging",
      lines: [
        `Sift could not read the last ${mins} minutes of Cloud Functions logs.`,
        `Reason: ${assessment.unavailable}`,
        "",
        "This is NOT a report that the backend is healthy — it is a report that",
        "nothing is currently watching it. Check the runtime service account has",
        "roles/logging.viewer on the project.",
      ],
    };
  }

  const lead = assessment.offenders.length === 1 ?
    `${assessment.offenders[0].name} is producing server errors` :
    `${assessment.offenders.length} Cloud Functions are producing server errors`;

  const lines = [
    `${assessment.total} ERROR log entries in the last ${mins} minutes.`,
    "",
  ];

  for (const o of assessment.offenders) {
    const kinds = Object.entries(o.kinds || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k}×${n}`)
        .join(", ");
    lines.push(`• ${o.name} — ${o.count} error${o.count === 1 ? "" : "s"} [${o.severity}]`);
    if (kinds) lines.push(`    classes: ${kinds}`);
    if (o.platformKinds && o.platformKinds.length) {
      lines.push(
          "    platform-level failure: the instance could not run, so no",
          "    in-process error reporter would ever have seen this.",
      );
    }
    if (o.sample) lines.push(`    sample: ${o.sample}`);
  }

  if (projectId) {
    lines.push(
        "",
        "Logs: https://console.cloud.google.com/logs/query?project=" + projectId,
    );
  }

  return {title: lead, lines};
}

module.exports = {
  WINDOW_MS,
  WARN_PER_FUNCTION,
  WARN_TOTAL,
  CRITICAL_PER_FUNCTION,
  NOTIFY_COOLDOWN_MS,
  MAX_OFFENDERS,
  DEFAULT_KIND,
  FAILURE_CLASSES,
  classifyMessage,
  isPlatformKind,
  buildLogFilter,
  functionNameOf,
  messageOf,
  summarizeErrorEntries,
  assessErrors,
  offenderKey,
  shouldNotify,
  buildAlert,
};
