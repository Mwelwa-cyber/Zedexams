/**
 * Unit tests for functions/agents/rollups.js — coalescing of repeat
 * awaiting_approval rollups from the scheduled agents.
 * Plain node: throws on first failed assertion.
 *
 *   node functions/agents/rollups.test.js
 */
const assert = require("node:assert");
const {writeAgentRollup} = require("./rollups");

const SERVER_TS = "__server_ts__";
const fieldValue = {serverTimestamp: () => SERVER_TS};

// Minimal fake of the agentJobs collection: supports the equality-only
// where().where().where().limit().get() chain plus add() and doc updates.
function makeDb(existingDocs = []) {
  const docs = existingDocs.map((data, i) => {
    const entry = {id: `existing-${i}`, data: {...data}, updates: []};
    entry.snap = {
      id: entry.id,
      data: () => entry.data,
      ref: {
        async update(fields) {
          entry.updates.push(fields);
          entry.data = {...entry.data, ...fields};
        },
      },
    };
    return entry;
  });
  const added = [];

  function makeQuery(filters) {
    return {
      where(field, op, value) {
        return makeQuery([...filters, {field, value}]);
      },
      limit() { return this; },
      async get() {
        const matches = docs.filter((d) => filters.every(({field, value}) => {
          const v = field.split(".").reduce((o, k) => (o || {})[k], d.data);
          return v === value;
        }));
        return {
          empty: matches.length === 0,
          docs: matches.map((d) => d.snap),
        };
      },
    };
  }

  return {
    db: {
      collection(name) {
        assert.strictEqual(name, "agentJobs");
        const q = makeQuery([]);
        q.add = async (fields) => { added.push(fields); return {id: "new-doc"}; };
        return q;
      },
    },
    docs,
    added,
  };
}

const baseJob = {
  agentId: "vigil",
  department: "qaEng",
  status: "awaiting_approval",
  input: {runType: "hourly-monitor"},
  output: {vigil: {ok: false, checks: ["fresh"]}},
  createdBy: "system",
  runMs: 1234,
};

// 1) No open rollup → plain add with a stamped createdAt.
(async function testAddsWhenQueueClean() {
  const {db, added} = makeDb([]);
  await writeAgentRollup(db, fieldValue, baseJob);
  assert.strictEqual(added.length, 1, "adds a new doc");
  assert.strictEqual(added[0].createdAt, SERVER_TS, "createdAt stamped");
  assert.strictEqual(added[0].agentId, "vigil");
})();

// 2) Open rollup for the same agent + runType → coalesce, don't add.
(async function testCoalescesIntoOpenRollup() {
  const {db, docs, added} = makeDb([{
    agentId: "vigil",
    status: "awaiting_approval",
    input: {runType: "hourly-monitor"},
    output: {vigil: {ok: false, checks: ["stale"]}},
    createdAt: "t0",
  }]);
  await writeAgentRollup(db, fieldValue, baseJob);
  assert.strictEqual(added.length, 0, "no sibling doc added");
  assert.strictEqual(docs[0].updates.length, 1, "existing doc updated");
  const u = docs[0].updates[0];
  assert.deepStrictEqual(u.output, baseJob.output, "carries the newest report");
  assert.strictEqual(u.createdAt, SERVER_TS, "createdAt refreshed (Marshal window check)");
  assert.strictEqual(u.firstSeenAt, "t0", "original createdAt kept as firstSeenAt");
  assert.strictEqual(u.coalescedRuns, 2, "second run folded in");
})();

// 3) Repeated coalescing keeps firstSeenAt and counts up.
(async function testRepeatedCoalescing() {
  const {db, docs} = makeDb([{
    agentId: "vigil",
    status: "awaiting_approval",
    input: {runType: "hourly-monitor"},
    createdAt: "t5",
    firstSeenAt: "t0",
    coalescedRuns: 5,
  }]);
  await writeAgentRollup(db, fieldValue, baseJob);
  const u = docs[0].updates[0];
  assert.strictEqual(u.firstSeenAt, "t0", "firstSeenAt is set once");
  assert.strictEqual(u.coalescedRuns, 6, "counter increments");
})();

// 4) A different runType or agent never coalesces.
(async function testNoCrossCoalescing() {
  const {db, added} = makeDb([
    {agentId: "vigil", status: "awaiting_approval", input: {runType: "other-run"}},
    {agentId: "till", status: "awaiting_approval", input: {runType: "hourly-monitor"}},
  ]);
  await writeAgentRollup(db, fieldValue, baseJob);
  assert.strictEqual(added.length, 1, "no match → new doc");
})();

// 5) Acknowledged (approved/done) rollups are history — a new problem opens
//    a fresh card instead of resurrecting the acknowledged one.
(async function testAcknowledgedNotReopened() {
  const {db, docs, added} = makeDb([{
    agentId: "vigil",
    status: "approved",
    input: {runType: "hourly-monitor"},
  }]);
  await writeAgentRollup(db, fieldValue, baseJob);
  assert.strictEqual(added.length, 1, "acknowledged card left alone");
  assert.strictEqual(docs[0].updates.length, 0);
})();

// 6) done / failed rollups never coalesce, even with an open card present.
(async function testNonAwaitingAlwaysAdds() {
  const {db, added} = makeDb([{
    agentId: "vigil",
    status: "awaiting_approval",
    input: {runType: "hourly-monitor"},
  }]);
  await writeAgentRollup(db, fieldValue, {...baseJob, status: "done"});
  assert.strictEqual(added.length, 1, "quiet runs are their own history");
  assert.strictEqual(added[0].status, "done");
})();

console.log("rollups.test.js: all assertions passed");
