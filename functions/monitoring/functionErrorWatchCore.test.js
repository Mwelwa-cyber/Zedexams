"use strict";

/**
 * Decisions of the Cloud Functions error watch.
 *
 * Run: node functions/monitoring/functionErrorWatchCore.test.js
 *
 * The load-bearing test is the last one: it replays the actual 2026-08-09
 * incident — 80 errors in 2h, all from apitrackvisit, "Memory limit of 128 MiB
 * exceeded" — and asserts an alert would have been raised on the FIRST window,
 * not after a rate built up. That incident went unnoticed for hours, so
 * "would this have caught it" is the only question worth answering here.
 */
const assert = require("node:assert");
const {
  OOM_PATTERNS,
  isOomEntry,
  groupByFunction,
  decideAlerts,
  buildAlertMessage,
} = require("./functionErrorWatchCore");

const MIN = 60_000;
const T0 = 1_754_700_000_000; // fixed epoch — never Date.now()

const entry = (functionName, message) => ({functionName, message});
const nEntries = (functionName, count, message = "boom") =>
  Array.from({length: count}, () => entry(functionName, message));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── OOM recognition ─────────────────────────────────────────────────────────

test("the EXACT string Google emitted on 2026-08-09 is recognised", () => {
  // Pinned verbatim. If a wording change upstream stops matching, this fails
  // rather than the alert quietly downgrading to rate-based.
  assert.strictEqual(
    isOomEntry({message: "Memory limit of 128 MiB exceeded with 130 MiB used"}),
    true,
  );
});

test("common OOM wordings are recognised, case-insensitively", () => {
  for (const m of [
    "Function exceeded memory limit",
    "Process ran out of memory",
    "Container terminated: OOM",
    "MEMORY LIMIT OF 256 MiB EXCEEDED",
  ]) {
    assert.strictEqual(isOomEntry({message: m}), true, `not recognised: ${m}`);
  }
});

test("an ordinary error is not an OOM", () => {
  assert.strictEqual(isOomEntry({message: "TypeError: x is not a function"}), false);
  assert.strictEqual(isOomEntry({message: ""}), false);
  assert.strictEqual(isOomEntry({}), false);
});

test("OOM_PATTERNS is exported so the fragile part is inspectable", () => {
  assert.ok(Array.isArray(OOM_PATTERNS) && OOM_PATTERNS.length > 0);
  assert.ok(Object.isFrozen(OOM_PATTERNS));
});

// ── Grouping ────────────────────────────────────────────────────────────────

test("an unattributable error is counted, never dropped", () => {
  const grouped = groupByFunction([entry(undefined, "x"), entry("", "y")]);
  assert.strictEqual(grouped.get("(unknown)").length, 2);
});

// ── Immediate OOM ───────────────────────────────────────────────────────────

test("ONE memory kill alerts immediately — no rate required", () => {
  const {alerts} = decideAlerts({
    entries: [entry("apitrackvisit", "Memory limit of 128 MiB exceeded")],
    state: {},
    now: T0,
  });
  const oom = alerts.filter((a) => a.kind === "oom");
  assert.strictEqual(oom.length, 1);
  assert.strictEqual(oom[0].functionName, "apitrackvisit");
  assert.strictEqual(oom[0].severity, "critical");
});

test("a repeat OOM inside the cooldown does NOT alert again", () => {
  const first = decideAlerts({
    entries: [entry("f", "memory limit of 128 MiB exceeded")],
    state: {}, now: T0,
  });
  const second = decideAlerts({
    entries: [entry("f", "memory limit of 128 MiB exceeded")],
    state: first.nextState, now: T0 + 5 * MIN,
  });
  assert.strictEqual(second.alerts.filter((a) => a.kind === "oom").length, 0);
});

test("…but it alerts again once the cooldown expires", () => {
  const first = decideAlerts({
    entries: [entry("f", "memory limit of 128 MiB exceeded")],
    state: {}, now: T0,
  });
  const later = decideAlerts({
    entries: [entry("f", "memory limit of 128 MiB exceeded")],
    state: first.nextState, now: T0 + 61 * MIN,
  });
  assert.strictEqual(later.alerts.filter((a) => a.kind === "oom").length, 1);
});

// ── Sustained rate ──────────────────────────────────────────────────────────

test("a single elevated window does NOT alert — that is a spike, not a fault", () => {
  const {alerts} = decideAlerts({entries: nEntries("f", 25), state: {}, now: T0});
  assert.strictEqual(alerts.filter((a) => a.kind === "sustained").length, 0);
});

test("two consecutive elevated windows DO alert", () => {
  const w1 = decideAlerts({entries: nEntries("f", 25), state: {}, now: T0});
  const w2 = decideAlerts({entries: nEntries("f", 25), state: w1.nextState, now: T0 + 5 * MIN});
  const sustained = w2.alerts.filter((a) => a.kind === "sustained");
  assert.strictEqual(sustained.length, 1);
  assert.strictEqual(sustained[0].windows, 2);
});

test("a quiet window resets the streak", () => {
  const w1 = decideAlerts({entries: nEntries("f", 25), state: {}, now: T0});
  const w2 = decideAlerts({entries: [], state: w1.nextState, now: T0 + 5 * MIN});
  const w3 = decideAlerts({entries: nEntries("f", 25), state: w2.nextState, now: T0 + 10 * MIN});
  assert.strictEqual(w3.alerts.filter((a) => a.kind === "sustained").length, 0);
});

test("errors are grouped PER FUNCTION, not globally", () => {
  // 80 errors spread over 40 functions is a bad afternoon; 80 from one is a
  // broken function. A global threshold cannot tell those apart.
  const spread = Array.from({length: 40}, (_, i) => nEntries(`fn${i}`, 2)).flat();
  const w1 = decideAlerts({entries: spread, state: {}, now: T0});
  const w2 = decideAlerts({entries: spread, state: w1.nextState, now: T0 + 5 * MIN});
  assert.strictEqual(w2.alerts.filter((a) => a.kind === "sustained").length, 0,
    "80 errors across 40 functions should not page anyone");
});

// ── Recovery ────────────────────────────────────────────────────────────────

test("a function that was alerting and goes quiet reports RECOVERED once", () => {
  const w1 = decideAlerts({
    entries: [entry("f", "memory limit of 128 MiB exceeded")], state: {}, now: T0,
  });
  const w2 = decideAlerts({entries: [], state: w1.nextState, now: T0 + 5 * MIN});
  assert.strictEqual(w2.alerts.filter((a) => a.kind === "recovered").length, 1);
  const w3 = decideAlerts({entries: [], state: w2.nextState, now: T0 + 10 * MIN});
  assert.strictEqual(w3.alerts.length, 0, "recovery must not repeat forever");
});

// ── Message ─────────────────────────────────────────────────────────────────

test("no alerts renders no message (silence is not an empty page)", () => {
  assert.strictEqual(buildAlertMessage([], {}), null);
});

test("a memory kill renders as critical and names the function", () => {
  const msg = buildAlertMessage(
    [{kind: "oom", severity: "critical", functionName: "apitrackvisit", count: 3,
      sample: "Memory limit of 128 MiB exceeded"}],
    {totalErrors: 3, functionsWithErrors: 1},
  );
  assert.strictEqual(msg.severity, "critical");
  assert.ok(msg.title.includes("memory"));
  assert.ok(msg.lines.join("\n").includes("apitrackvisit"));
  assert.ok(msg.lines.join("\n").includes("Sentry does not observe Cloud Functions"),
    "the message must say why Sentry being clean is not reassurance");
});

test("several broken functions are ONE message, not one page each", () => {
  const msg = buildAlertMessage([
    {kind: "oom", functionName: "a", count: 1, sample: ""},
    {kind: "sustained", functionName: "b", count: 30, windows: 2, sample: ""},
    {kind: "sustained", functionName: "c", count: 40, windows: 3, sample: ""},
  ], {totalErrors: 71, functionsWithErrors: 3});
  assert.strictEqual(typeof msg.title, "string");
  assert.ok(msg.lines.join("\n").includes("a"));
  assert.ok(msg.lines.join("\n").includes("b"));
  assert.ok(msg.lines.join("\n").includes("c"));
});

// ── The incident ────────────────────────────────────────────────────────────

test("REGRESSION: the 2026-08-09 apiTrackVisit incident alerts on the FIRST window", () => {
  // 80 ERRORs over 2h, every one from apitrackvisit, memory limit exceeded.
  // At a 5-minute cadence the first window holds a few of them. The point is
  // that ONE is enough: this incident ran for hours unnoticed, and a
  // rate-based-only design would have delayed the alert by the same hours.
  const firstWindow = nEntries(
    "apitrackvisit", 3, "Memory limit of 128 MiB exceeded with 130 MiB used",
  );
  const {alerts, summary} = decideAlerts({entries: firstWindow, state: {}, now: T0});

  const oom = alerts.filter((a) => a.kind === "oom");
  assert.strictEqual(oom.length, 1, "the incident must alert on its first window");
  assert.strictEqual(oom[0].functionName, "apitrackvisit");
  assert.deepStrictEqual(summary.oomFunctions, ["apitrackvisit"]);

  const msg = buildAlertMessage(alerts, summary);
  assert.strictEqual(msg.severity, "critical");
});

test("CONTROL: without OOM recognition the same window would NOT alert", () => {
  // Proves the regression test is load-bearing. 3 errors is below the
  // sustained threshold, so if the message were not recognised as a memory
  // kill, this window produces nothing — which is exactly what happened.
  const unrecognised = nEntries("apitrackvisit", 3, "some error we do not classify");
  const {alerts} = decideAlerts({entries: unrecognised, state: {}, now: T0});
  assert.strictEqual(alerts.length, 0,
    "control failed: an unrecognised low-count error should raise nothing");
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`function error watch (core): ${passed} passed`);
})();
