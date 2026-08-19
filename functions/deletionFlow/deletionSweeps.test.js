"use strict";

/**
 * The two sweeps, against a faked Firestore.
 *
 * The state machine is tested next door; what is tested HERE is the thing the
 * machine cannot express — the ORDER of the writes, and what survives a
 * failure halfway through.
 *
 * The one that matters most: **purge first, `completed` second**. Writing
 * `completed` before the purge succeeds would mark an account deleted that
 * still exists, and nothing would ever look at it again — the data would sit
 * there permanently while every screen and every report said it was gone. The
 * test forces the purge to throw and asserts the request is still `scheduled`,
 * because "the next sweep retries it" is only true if nothing moved it.
 *
 * Run: npm run test:deletion-sweeps
 */

const assert = require("node:assert/strict");

const core = require("./deletionRequestCore");

// The module pulls in firebase-functions at load, which needs these.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "test-project";
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG ||
  JSON.stringify({projectId: "test-project"});

const {runDeletionRequestSweep, runDeletionExecutionSweep} = require("./index");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const NOW = Date.parse("2026-09-19T12:00:00Z");
const days = (n) => n * core.MS_PER_DAY;

/**
 * A Firestore stand-in that answers exactly the two queries the sweeps make
 * (`state == X`, limited) and records every write. Deliberately dumb: a fake
 * clever enough to be wrong is worse than no fake.
 */
function fakeDb(docsByState) {
  const writes = [];
  return {
    writes,
    collection(name) {
      return {
        where(field, _op, value) {
          assert.equal(field, "state", "the sweeps only ever query on state");
          return {
            limit() {
              return {
                async get() {
                  const rows = docsByState[value] || [];
                  return {
                    docs: rows.map((row) => ({
                      id: row.id,
                      data: () => ({...row}),
                      ref: {
                        async set(patch, opts) {
                          writes.push({kind: "set", collection: name, id: row.id, patch, opts});
                        },
                      },
                    })),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

const recorder = () => {
  const calls = [];
  return {
    calls,
    commitTransition: async (args) => { calls.push({kind: "commit", ...args}); },
    notifyLearner: async (learnerId, kind, extra) => {
      calls.push({kind: "notify", learnerId, notifyKind: kind, extra});
    },
  };
};

const pendingDoc = (over = {}) => ({
  id: "req-pending",
  learnerId: "l1",
  guardianUid: "g1",
  state: core.STATE.PENDING_GUARDIAN,
  requestedAt: NOW - days(8),
  ...over,
});

const scheduledDoc = (over = {}) => ({
  id: "req-scheduled",
  learnerId: "l2",
  guardianUid: "g1",
  state: core.STATE.SCHEDULED,
  requestedAt: NOW - days(31),
  scheduledDeleteAt: NOW - days(1),
  ...over,
});

/* ── The 7-day escalation ────────────────────────────────────────────── */

test("a request nobody answered escalates, and the child is told", async () => {
  const rec = recorder();
  const summary = await runDeletionRequestSweep({
    db: fakeDb({[core.STATE.PENDING_GUARDIAN]: [pendingDoc()], [core.STATE.SCHEDULED]: []}),
    now: NOW,
    ...rec,
  });
  assert.equal(summary.escalated, 1);
  const commit = rec.calls.find((c) => c.kind === "commit");
  assert.equal(commit.patch.state, core.STATE.ESCALATED_SUPPORT);
  assert.equal(commit.actor, "system");
  const notify = rec.calls.find((c) => c.kind === "notify");
  assert.equal(notify.notifyKind, "escalated");
  assert.equal(notify.learnerId, "l1");
});

test("a request still inside its seven days is left completely alone", async () => {
  const rec = recorder();
  const summary = await runDeletionRequestSweep({
    db: fakeDb({
      [core.STATE.PENDING_GUARDIAN]: [pendingDoc({requestedAt: NOW - days(3)})],
      [core.STATE.SCHEDULED]: [],
    }),
    now: NOW,
    ...rec,
  });
  assert.equal(summary.escalated, 0);
  assert.equal(rec.calls.length, 0, "a sweep must not touch what is not due");
});

test("one failing request does not stop the rest of the sweep", async () => {
  const calls = [];
  let first = true;
  const summary = await runDeletionRequestSweep({
    db: fakeDb({
      [core.STATE.PENDING_GUARDIAN]: [
        pendingDoc({id: "boom"}),
        pendingDoc({id: "fine", learnerId: "l9"}),
      ],
      [core.STATE.SCHEDULED]: [],
    }),
    now: NOW,
    commitTransition: async (args) => {
      if (first) { first = false; throw new Error("firestore said no"); }
      calls.push(args);
    },
    notifyLearner: async () => {},
  });
  assert.equal(summary.escalated, 1);
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].id, "boom");
  assert.equal(calls[0].requestId, "fine", "the second request still escalated");
});

/* ── The day-25 reminder ─────────────────────────────────────────────── */

test("a closing window reminds the child once, with a real number", async () => {
  const rec = recorder();
  const summary = await runDeletionRequestSweep({
    db: fakeDb({
      [core.STATE.PENDING_GUARDIAN]: [],
      [core.STATE.SCHEDULED]: [scheduledDoc({scheduledDeleteAt: NOW + days(3)})],
    }),
    now: NOW,
    serverTimestamp: "STAMP",
    ...rec,
  });
  assert.equal(summary.reminded, 1);
  const notify = rec.calls.find((c) => c.kind === "notify");
  assert.equal(notify.notifyKind, "reminder");
  assert.equal(notify.extra.daysLeft, 3);
});

test("a reminder already sent is not sent again", async () => {
  const rec = recorder();
  const summary = await runDeletionRequestSweep({
    db: fakeDb({
      [core.STATE.PENDING_GUARDIAN]: [],
      [core.STATE.SCHEDULED]: [scheduledDoc({
        scheduledDeleteAt: NOW + days(2),
        graceReminderSentAt: NOW - days(1),
      })],
    }),
    now: NOW,
    ...rec,
  });
  assert.equal(summary.reminded, 0);
  assert.equal(rec.calls.length, 0);
});

/* ── The 30-day executor ─────────────────────────────────────────────── */

test("a closed window purges, and only then writes completed", async () => {
  const order = [];
  const summary = await runDeletionExecutionSweep({
    db: fakeDb({[core.STATE.SCHEDULED]: [scheduledDoc()]}),
    now: NOW,
    serverTimestamp: "STAMP",
    purge: async (learnerId) => { order.push(`purge:${learnerId}`); },
    commitTransition: async (args) => { order.push(`commit:${args.patch.state}`); },
  });
  assert.equal(summary.deleted, 1);
  assert.deepEqual(order, ["purge:l2", `commit:${core.STATE.COMPLETED}`],
    "the purge must succeed BEFORE the request is marked completed");
});

test("A FAILED PURGE LEAVES THE REQUEST SCHEDULED, so the next sweep retries it", async () => {
  const commits = [];
  const summary = await runDeletionExecutionSweep({
    db: fakeDb({[core.STATE.SCHEDULED]: [scheduledDoc()]}),
    now: NOW,
    purge: async () => { throw new Error("purge exploded"); },
    commitTransition: async (args) => { commits.push(args); },
  });
  assert.equal(summary.deleted, 0);
  assert.equal(commits.length, 0,
    "marking an account deleted that still exists would hide it from every future sweep");
  assert.equal(summary.errors.length, 1);
  assert.equal(summary.errors[0].learnerId, "l2");
});

test("a window that has not closed is skipped, and nothing is purged", async () => {
  let purged = 0;
  const summary = await runDeletionExecutionSweep({
    db: fakeDb({[core.STATE.SCHEDULED]: [scheduledDoc({scheduledDeleteAt: NOW + days(5)})]}),
    now: NOW,
    purge: async () => { purged += 1; },
    commitTransition: async () => {},
  });
  assert.equal(purged, 0, "NOTHING is deleted before the window closes");
  assert.equal(summary.deleted, 0);
  assert.equal(summary.skipped, 1);
});

test("a scheduled request with no date is skipped rather than purged", async () => {
  let purged = 0;
  const summary = await runDeletionExecutionSweep({
    db: fakeDb({[core.STATE.SCHEDULED]: [scheduledDoc({scheduledDeleteAt: null})]}),
    now: NOW + days(365),
    purge: async () => { purged += 1; },
    commitTransition: async () => {},
  });
  assert.equal(purged, 0, "'we do not know when this was due' must never resolve to 'now'");
  assert.equal(summary.skipped, 1);
});

test("one failing purge does not stop the others", async () => {
  const purged = [];
  const summary = await runDeletionExecutionSweep({
    db: fakeDb({
      [core.STATE.SCHEDULED]: [
        scheduledDoc({id: "a", learnerId: "la"}),
        scheduledDoc({id: "b", learnerId: "lb"}),
      ],
    }),
    now: NOW,
    purge: async (uid) => {
      if (uid === "la") throw new Error("no");
      purged.push(uid);
    },
    commitTransition: async () => {},
  });
  assert.deepEqual(purged, ["lb"]);
  assert.equal(summary.deleted, 1);
  assert.equal(summary.errors.length, 1);
});

/* ── Runner ──────────────────────────────────────────────────────────── */

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}\n    ${err.message}`);
    }
  }
  console.log(`\ndeletion sweeps: ${tests.length - failed}/${tests.length} passed`);
  if (failed) {
    console.error(`${failed} deletion-sweep test(s) failed`);
    process.exitCode = 1;
  }
})();
