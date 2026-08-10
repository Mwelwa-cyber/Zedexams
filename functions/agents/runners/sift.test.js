/**
 * Node tests for Sift's orchestration (runSift) — the parts with real failure
 * modes, driven through injected fakes (no Firestore, no Cloud Logging).
 * Run: node functions/agents/runners/sift.test.js
 *
 * What these pin down:
 *   • a quiet window sends nothing (an alerting agent that alerts on quiet gets
 *     muted, and a muted alert is the state we started in);
 *   • an UNREADABLE window still alerts — this is the one that matters, because
 *     it is the failure mode #2230 was actually about;
 *   • the 24h cooldown is per finding, so a newly-broken function in a run
 *     whose other offenders are suppressed still gets through;
 *   • a failed SEND does not start a 24h silence about a live problem.
 */

const assert = require("node:assert");
const {runSift} = require("./sift");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const NOW = 1_700_000_000_000;

/** Minimal Firestore double: one doc, get/set/update, records writes. */
function fakeDb(initialKeys = {}) {
  const store = {keys: {...initialKeys}};
  const writes = [];
  return {
    store,
    writes,
    doc: () => ({
      get: async () => ({exists: true, data: () => store}),
      set: async () => {},
      update: async (patch) => {
        writes.push(patch);
        for (const [path, value] of Object.entries(patch)) {
          const key = path.replace(/^keys\./, "");
          store.keys[key] = value;
        }
      },
    }),
  };
}

function entry(serviceName, textPayload) {
  return {
    severity: "ERROR",
    timestamp: "2026-08-09T18:00:00Z",
    resource: {type: "cloud_run_revision", labels: {service_name: serviceName}},
    textPayload,
  };
}

/** A fetchEntries double returning a fixed set of entries. */
function entriesOf(list) {
  return async () => ({entries: list, truncated: false});
}

function recorder(result = {delivered: true, channels: {}}) {
  const calls = [];
  const fn = async (alert) => {
    calls.push(alert);
    if (result instanceof Error) throw result;
    return result;
  };
  fn.calls = calls;
  return fn;
}

async function main() {
  console.log("sift.runSift");

  // ── a quiet window is quiet ────────────────────────────────────────────────
  {
    const notify = recorder();
    const report = await runSift({
      db: fakeDb(),
      notify,
      now: NOW,
      projectId: "p",
      fetchEntries: entriesOf([]),
    });
    ok("no errors → ok", report.ok === true);
    ok("no errors → no alert sent", notify.calls.length === 0);
    ok("no errors → nothing recorded as notified", report.notified.length === 0);
  }

  // ── an unreadable window ALERTS ────────────────────────────────────────────
  {
    const notify = recorder();
    const report = await runSift({
      db: fakeDb(),
      notify,
      now: NOW,
      projectId: "p",
      fetchEntries: async () => {
        throw new Error("logging entries:list 403: caller lacks logging.logEntries.list");
      },
    });
    ok("read failure → not ok", report.ok === false);
    ok("read failure → alert sent", notify.calls.length === 1);
    ok("read failure → reason carried into the report", /403/.test(report.unavailable));
    ok(
        "read failure → alert names the missing permission",
        /logging/i.test(notify.calls[0].lines.join("\n")),
    );
    ok("read failure → total is 0 but ok is NOT true", report.total === 0 && report.ok === false);
  }

  // ── the incident: a critical alert goes out and is remembered ──────────────
  {
    const db = fakeDb();
    const notify = recorder();
    const oom = Array.from({length: 40}, () =>
      entry("apitrackvisit", "Memory limit of 128 MiB exceeded"));

    const report = await runSift({
      db, notify, now: NOW, projectId: "examsprepzambia", fetchEntries: entriesOf(oom),
    });
    ok("incident → critical alert sent", notify.calls.length === 1 && notify.calls[0].severity === "critical");
    ok("incident → recorded as notified", report.notified.length === 1);
    ok("incident → state persisted for the key", Object.keys(db.store.keys).length === 1);

    // Same problem an hour later: suppressed by the cooldown.
    const notify2 = recorder();
    const later = await runSift({
      db, notify: notify2, now: NOW + 3600_000, projectId: "examsprepzambia",
      fetchEntries: entriesOf(oom),
    });
    ok("same problem next hour → no second alert", notify2.calls.length === 0);
    ok("…but still reported as not ok", later.ok === false);
    ok("…and recorded as suppressed", later.suppressed.length === 1);
  }

  // ── the cooldown is PER FINDING, not per run ───────────────────────────────
  {
    // apitrackvisit was alerted about 10 minutes ago; a second function has just
    // started failing in the same run. The new one must not inherit the silence.
    const db = fakeDb({
      "apitrackvisit:memory_exceeded": {severity: "critical", notifiedAtMs: NOW - 600_000},
    });
    const notify = recorder();
    const report = await runSift({
      db, notify, now: NOW, projectId: "p",
      fetchEntries: entriesOf([
        ...Array.from({length: 30}, () => entry("apitrackvisit", "Memory limit of 128 MiB exceeded")),
        ...Array.from({length: 30}, () => entry("lencowebhook", "Error: signature mismatch")),
      ]),
    });
    ok("a newly-broken function still alerts", notify.calls.length === 1);
    ok("only the new finding is recorded", report.notified.length === 1 &&
      report.notified[0].startsWith("lencowebhook"));
    ok("the old finding is suppressed", report.suppressed.some((k) => k.startsWith("apitrackvisit")));
  }

  // ── a failed send must not start a 24h silence ─────────────────────────────
  {
    const db = fakeDb();
    const report = await runSift({
      db,
      notify: recorder(new Error("SMTP down and webhook 500")),
      now: NOW,
      projectId: "p",
      fetchEntries: entriesOf(
          Array.from({length: 40}, () => entry("apitrackvisit", "Memory limit of 128 MiB exceeded")),
      ),
    });
    ok("send threw → delivery recorded as failed", report.delivery.delivered === false);
    ok("send threw → nothing marked notified", report.notified.length === 0);
    ok("send threw → no cooldown state written", Object.keys(db.store.keys).length === 0);
    ok("send threw → the run is still not ok", report.ok === false);

    // Next run retries rather than sitting silent for a day.
    const notify2 = recorder();
    await runSift({
      db, notify: notify2, now: NOW + 3600_000, projectId: "p",
      fetchEntries: entriesOf(
          Array.from({length: 40}, () => entry("apitrackvisit", "Memory limit of 128 MiB exceeded")),
      ),
    });
    ok("next run retries the undelivered alert", notify2.calls.length === 1);
  }

  // A delivery that reports `delivered: false` (both channels unconfigured) is
  // the same case as a throw — it did not reach anyone, so it must not silence.
  {
    const db = fakeDb();
    const report = await runSift({
      db,
      notify: recorder({delivered: false, channels: {}}),
      now: NOW,
      projectId: "p",
      fetchEntries: entriesOf(
          Array.from({length: 40}, () => entry("somefn", "Memory limit of 256 MiB exceeded")),
      ),
    });
    ok("undelivered alert → no cooldown state", Object.keys(db.store.keys).length === 0);
    ok("undelivered alert → nothing marked notified", report.notified.length === 0);
  }

  // A lost/unreadable state doc re-alerts rather than throwing — losing the
  // memory must degrade to "say it again", never to "say nothing".
  {
    const brokenDb = {
      doc: () => ({
        get: async () => {
          throw new Error("firestore unavailable");
        },
        set: async () => {},
        update: async () => {},
      }),
    };
    const notify = recorder();
    const report = await runSift({
      db: brokenDb, notify, now: NOW, projectId: "p",
      fetchEntries: entriesOf(
          Array.from({length: 40}, () => entry("somefn", "Memory limit of 256 MiB exceeded")),
      ),
    });
    ok("unreadable state → still alerts", notify.calls.length === 1);
    ok("unreadable state → run does not throw", report.ok === false);
  }
}

main().then(() => {
  console.log(`\n${passed} assertions passed`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
