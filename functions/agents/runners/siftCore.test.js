/**
 * Node tests for Sift's pure decisions (siftCore.js).
 * Run: node functions/agents/runners/siftCore.test.js
 *
 * The load-bearing cases, in the order they matter:
 *   1. An UNREADABLE window is never reported as a healthy one. This is the
 *      whole point of the module — #2230's real finding was that a tool which
 *      cannot see a failure reporting silence had been read as health.
 *   2. The apiTrackVisit incident itself is caught, from real log shapes.
 *   3. A platform-level class (OOM / startup / timeout) is critical on sight,
 *      because "the instance cannot run" does not get truer with volume.
 *   4. Ordinary noise does NOT alert, or the alert gets muted and we are back
 *      where we started.
 *   5. Cooldown suppresses repeats but an escalation always gets through.
 */

const assert = require("node:assert");
const {
  WINDOW_MS,
  WARN_PER_FUNCTION,
  WARN_TOTAL,
  CRITICAL_PER_FUNCTION,
  NOTIFY_COOLDOWN_MS,
  MAX_OFFENDERS,
  DEFAULT_KIND,
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
} = require("./siftCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const NOW = 1_700_000_000_000;

/** A v2 (Cloud Run) entry, the shape the Logging API actually returns. */
function v2Entry(serviceName, textPayload, timestamp = "2026-08-09T18:00:00Z") {
  return {
    severity: "ERROR",
    timestamp,
    resource: {type: "cloud_run_revision", labels: {service_name: serviceName}},
    textPayload,
  };
}

/** A v1 entry — a whole SDK generation that must not be invisible (#2233). */
function v1Entry(functionName, textPayload) {
  return {
    severity: "ERROR",
    timestamp: "2026-08-09T18:00:00Z",
    resource: {type: "cloud_function", labels: {function_name: functionName}},
    textPayload,
  };
}

console.log("siftCore");

// ── 1. an unreadable window is NOT a healthy window ────────────────────────
{
  const r = assessErrors({unavailable: "logging entries:list 403: caller lacks permission"});
  ok("unavailable → not ok", r.ok === false);
  ok("unavailable → carries the reason", /403/.test(r.unavailable));
  ok("unavailable → alerts at warning", r.severity === "warning");

  const {title, lines} = buildAlert({assessment: r});
  ok("unavailable alert says it could not read", /could not read/i.test(title));
  ok(
      "unavailable alert explicitly denies being a health report",
      lines.some((l) => /NOT a report that the backend is healthy/.test(l)),
  );
}

// An assessment built from a real (empty) read IS healthy — the two cases must
// stay distinguishable, or the rule above is decoration.
{
  const r = assessErrors({summary: summarizeErrorEntries([])});
  ok("read-and-empty → ok", r.ok === true && r.unavailable === null);
}

// ── 2. the apiTrackVisit incident ──────────────────────────────────────────
{
  // 80 errors in 2h, all from one function, the mix reported in #2230.
  const entries = [];
  for (let i = 0; i < 78; i += 1) {
    entries.push(v2Entry("apitrackvisit", "Memory limit of 128 MiB exceeded with 141 MiB used"));
  }
  entries.push(v2Entry("apitrackvisit", "POST 500 /api/track-visit"));
  entries.push(v2Entry("apitrackvisit",
      "The request was aborted because there was no available instance (503)"));

  const summary = summarizeErrorEntries(entries);
  ok("all 80 attributed to one function", summary.functions.length === 1 && summary.total === 80);
  ok("named as the platform names it", summary.functions[0].name === "apitrackvisit");
  ok("OOM classified", summary.functions[0].kinds.memory_exceeded === 78);

  const r = assessErrors({summary});
  ok("incident → critical", r.ok === false && r.severity === "critical");

  const {title, lines} = buildAlert({assessment: r, projectId: "examsprepzambia"});
  ok("alert names the function", /apitrackvisit/.test(title));
  const body = lines.join("\n");
  ok("alert quotes the OOM line, not the last line", /Memory limit of 128 MiB exceeded/.test(body));
  ok("alert explains why in-process reporting missed it", /no\s+in-process error reporter/.test(body));
  ok("alert links the logs console", /console\.cloud\.google\.com\/logs/.test(body));
}

// ── 3. platform classes are critical on sight ──────────────────────────────
{
  const cases = [
    ["Memory limit of 128 MiB exceeded", "memory_exceeded"],
    ["Container called exit(1) — container failed to start", "startup_failure"],
    ["Function execution took 60002 ms, finished with status: 'timeout'", "timeout"],
    ["Error: unhandled promise rejection in handler", "crash"],
    ["TypeError: Cannot read properties of undefined", "exception"],
    ["some entirely unremarkable line", DEFAULT_KIND],
  ];
  for (const [msg, kind] of cases) {
    ok(`classify: ${kind}`, classifyMessage(msg) === kind);
  }
  ok("memory_exceeded is a platform class", isPlatformKind("memory_exceeded") === true);
  ok("exception is NOT a platform class", isPlatformKind("exception") === false);

  // Three OOMs — far under CRITICAL_PER_FUNCTION — still critical.
  const summary = summarizeErrorEntries([
    v2Entry("somefn", "Memory limit of 256 MiB exceeded"),
    v2Entry("somefn", "Memory limit of 256 MiB exceeded"),
    v2Entry("somefn", "Memory limit of 256 MiB exceeded"),
  ]);
  ok("3 OOMs is under the count threshold", 3 < CRITICAL_PER_FUNCTION && 3 < WARN_PER_FUNCTION);
  const r = assessErrors({summary});
  ok("…but still critical", r.severity === "critical" && r.offenders.length === 1);
  ok("platformKinds surfaced to the alert", r.offenders[0].platformKinds.includes("memory_exceeded"));
}

// ── 4. noise does not alert ────────────────────────────────────────────────
{
  // Two ordinary application errors from two functions. Nothing systemic.
  const summary = summarizeErrorEntries([
    v2Entry("generateassessment", "Error: model returned malformed JSON"),
    v2Entry("lencowebhook", "Error: signature mismatch on inbound webhook"),
  ]);
  const r = assessErrors({summary});
  ok("two stray errors → quiet", r.ok === true && r.offenders.length === 0);
}
{
  // Just under the per-function warn threshold stays quiet; one more trips it.
  const quiet = summarizeErrorEntries(
      Array.from({length: WARN_PER_FUNCTION - 1}, () => v2Entry("fn", "Error: transient")),
  );
  ok(`${WARN_PER_FUNCTION - 1} errors → quiet`, assessErrors({summary: quiet}).ok === true);

  const loud = summarizeErrorEntries(
      Array.from({length: WARN_PER_FUNCTION}, () => v2Entry("fn", "Error: transient")),
  );
  const r = assessErrors({summary: loud});
  ok(`${WARN_PER_FUNCTION} errors → warning`, r.ok === false && r.severity === "warning");
}
{
  // Spread thin enough that no single function trips, but the total is high:
  // something systemic. WARN_TOTAL catches what per-function thresholds cannot.
  const entries = [];
  for (let i = 0; i < WARN_TOTAL; i += 1) {
    entries.push(v2Entry(`fn${i}`, "Error: transient"));
  }
  const r = assessErrors({summary: summarizeErrorEntries(entries)});
  ok("thinly-spread but high total → not ok", r.ok === false);
  ok("…with no single offender named", r.offenders.length === 0);
}

// ── 5. cooldown, and the escalation that beats it ──────────────────────────
{
  ok(
      "never alerted → send",
      shouldNotify({severity: "warning", previous: null, now: NOW}).notify === true,
  );
  ok(
      "same severity inside cooldown → suppress",
      shouldNotify({
        severity: "warning",
        previous: {severity: "warning", notifiedAtMs: NOW - 1000},
        now: NOW,
      }).notify === false,
  );
  ok(
      "cooldown elapsed → send again",
      shouldNotify({
        severity: "warning",
        previous: {severity: "warning", notifiedAtMs: NOW - NOTIFY_COOLDOWN_MS - 1},
        now: NOW,
      }).notify === true,
  );
  const esc = shouldNotify({
    severity: "critical",
    previous: {severity: "warning", notifiedAtMs: NOW - 1000},
    now: NOW,
  });
  ok("warning → critical beats the cooldown", esc.notify === true && esc.reason === "escalated");
  ok(
      "critical → critical still respects it",
      shouldNotify({
        severity: "critical",
        previous: {severity: "critical", notifiedAtMs: NOW - 1000},
        now: NOW,
      }).notify === false,
  );
}

// The key must change when the failure MODE changes, or a function that starts
// failing a new way is silenced by the old problem's cooldown.
{
  const a = offenderKey({name: "fn", kinds: {exception: 3}});
  const b = offenderKey({name: "fn", kinds: {memory_exceeded: 3}});
  const c = offenderKey({name: "fn", kinds: {exception: 9}});
  ok("different failure classes → different keys", a !== b);
  ok("same classes, different counts → same key", a === c);
  ok("key order is stable", offenderKey({name: "fn", kinds: {b: 1, a: 1}}) ===
    offenderKey({name: "fn", kinds: {a: 1, b: 1}}));
}

// ── log-reading mechanics ──────────────────────────────────────────────────
{
  const filter = buildLogFilter({sinceIso: "2026-08-09T18:00:00.000Z"});
  ok("filter restricts to ERROR and above", /severity>=ERROR/.test(filter));
  ok("filter is time-bounded", /timestamp>="2026-08-09T18:00:00\.000Z"/.test(filter));
  ok("filter covers v2 (Cloud Run)", /cloud_run_revision/.test(filter));
  ok("filter covers v1 (cloud_function)", /cloud_function/.test(filter));
}
{
  ok("v2 name from service_name", functionNameOf(v2Entry("apitrackvisit", "x")) === "apitrackvisit");
  ok("v1 name from function_name", functionNameOf(v1Entry("onUserDeleted", "x")) === "onUserDeleted");
  ok("unattributable entry → empty name", functionNameOf({resource: {}}) === "");

  const summary = summarizeErrorEntries([
    v1Entry("onUserDeleted", "Error: boom"),
    {severity: "ERROR", resource: {type: "global", labels: {}}, textPayload: "orphan"},
  ]);
  ok("v1 entries are counted", summary.functions.some((f) => f.name === "onUserDeleted"));
  ok("unattributable entries are counted, not dropped", summary.unattributed === 1);
  ok("total counts every entry read", summary.total === 2);
}
{
  // All three payload shapes — reading only textPayload would drop most of what
  // this codebase logs (logVisit emits one-line JSON).
  ok("textPayload", messageOf({textPayload: "plain"}) === "plain");
  ok("jsonPayload.message", messageOf({jsonPayload: {message: "structured"}}) === "structured");
  ok(
      "jsonPayload without a message field is serialised, not dropped",
      /track_visit_write_failed/.test(messageOf({jsonPayload: {event: "track_visit_write_failed"}})),
  );
  ok(
      "protoPayload status",
      messageOf({protoPayload: {status: {message: "permission denied"}}}) === "permission denied",
  );
  ok("no payload → empty, not a throw", messageOf({}) === "");
}

// Bounded output: one catastrophic hour must not produce an unbounded alert.
{
  const entries = [];
  for (let i = 0; i < MAX_OFFENDERS + 5; i += 1) {
    for (let j = 0; j < CRITICAL_PER_FUNCTION; j += 1) {
      entries.push(v2Entry(`fn${i}`, "Error: broken"));
    }
  }
  const r = assessErrors({summary: summarizeErrorEntries(entries)});
  ok("offenders are capped", r.offenders.length === MAX_OFFENDERS);
  ok("…but the total is honest", r.total === (MAX_OFFENDERS + 5) * CRITICAL_PER_FUNCTION);
  ok("offenders are worst-first", r.offenders[0].count >= r.offenders[r.offenders.length - 1].count);
}

// The window must overlap the schedule, not abut it — an exactly-hourly window
// on an hourly schedule loses every error that lands in the scheduling jitter.
ok("window is wider than the hourly schedule", WINDOW_MS > 3600_000);

console.log(`\n${passed} assertions passed`);
