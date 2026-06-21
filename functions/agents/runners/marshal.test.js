/**
 * Node test for Marshal's pure fleet assessment (assessFleet).
 * Run: node functions/agents/runners/marshal.test.js
 *
 * Covers: all-healthy, late, never-ran, paused breaker, stuck jobs, recent
 * failures, the late/ok threshold boundary, and the combined summary string.
 */

const assert = require("node:assert");
const {assessFleet, WATCHED} = require("./marshal");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const HOUR = 3600_000;
const NOW = 1_700_000_000_000;

// Helper: every watched agent ran 1 minute ago (comfortably on time).
function allFresh() {
  const m = {};
  for (const w of WATCHED) m[w.id] = NOW - 60_000;
  return m;
}

console.log("marshal.assessFleet");

// ── all healthy ────────────────────────────────────────────────────────────
{
  const r = assessFleet({now: NOW, lastRunByAgent: allFresh()});
  ok("all fresh → healthy", r.healthy === true);
  ok("watchedCount matches roster", r.watchedCount === WATCHED.length);
  ok("no late / never / paused", r.lateAgents.length === 0 && r.neverRan.length === 0 && r.pausedAgents.length === 0);
  ok("healthy summary mentions 'on time'", /on time/.test(r.summary));
  ok("every agent state ok", r.agents.every((a) => a.state === "ok"));
}

// ── a late agent ───────────────────────────────────────────────────────────
{
  const last = allFresh();
  last.vigil = NOW - 5 * HOUR; // hourly agent, 5h stale → well past grace
  const r = assessFleet({now: NOW, lastRunByAgent: last});
  ok("stale hourly agent → not healthy", r.healthy === false);
  ok("vigil flagged late", r.lateAgents.includes("vigil"));
  ok("late agent state is 'late'", r.agents.find((a) => a.id === "vigil").state === "late");
  ok("summary names the late agent", /vigil/.test(r.summary));
}

// ── late/ok threshold boundary ───────────────────────────────────────────────
{
  const vigil = WATCHED.find((w) => w.id === "vigil");
  const threshold = vigil.everyMs + vigil.graceMs;
  const atEdge = allFresh();
  atEdge.vigil = NOW - threshold; // exactly at threshold → still ok (> is late)
  ok("exactly at threshold → ok", assessFleet({now: NOW, lastRunByAgent: atEdge}).agents.find((a) => a.id === "vigil").state === "ok");
  const overEdge = allFresh();
  overEdge.vigil = NOW - (threshold + 1);
  ok("one ms past threshold → late", assessFleet({now: NOW, lastRunByAgent: overEdge}).lateAgents.includes("vigil"));
}

// ── never ran ────────────────────────────────────────────────────────────────
{
  const last = allFresh();
  last.anchor = null; // never seen
  const r = assessFleet({now: NOW, lastRunByAgent: last});
  ok("agent never seen → neverRan", r.neverRan.includes("anchor"));
  ok("never-ran → not healthy", r.healthy === false);
  ok("never state is 'never'", r.agents.find((a) => a.id === "anchor").state === "never");
}

// ── paused breaker ───────────────────────────────────────────────────────────
{
  const r = assessFleet({now: NOW, lastRunByAgent: allFresh(), pausedAgents: ["till", "aria"]});
  ok("paused agents surfaced (incl. non-watched)", r.pausedAgents.includes("till") && r.pausedAgents.includes("aria"));
  ok("paused watched agent state is 'paused'", r.agents.find((a) => a.id === "till").state === "paused");
  ok("paused → not healthy", r.healthy === false);
}

// ── stuck jobs ───────────────────────────────────────────────────────────────
{
  const r = assessFleet({
    now: NOW, lastRunByAgent: allFresh(),
    stuckJobs: [{id: "j1", agentId: "aria", status: "running", ageMs: 30 * 60_000}],
  });
  ok("stuck job → not healthy", r.healthy === false);
  ok("stuckCount counted", r.stuckCount === 1);
  ok("summary mentions stuck", /stuck/.test(r.summary));
}

// ── recent failures ──────────────────────────────────────────────────────────
{
  const r = assessFleet({
    now: NOW, lastRunByAgent: allFresh(),
    recentFailures: [{id: "f1", agentId: "reva", error: "boom", agoMs: HOUR}],
  });
  ok("recent failure → not healthy", r.healthy === false);
  ok("recentFailureCount counted", r.recentFailureCount === 1);
}

// ── lists are capped ─────────────────────────────────────────────────────────
{
  const many = Array.from({length: 40}, (_, i) => ({id: `j${i}`, agentId: "x", status: "queued", ageMs: HOUR}));
  const r = assessFleet({now: NOW, lastRunByAgent: allFresh(), stuckJobs: many});
  ok("stuckJobs list capped at 25", r.stuckJobs.length === 25 && r.stuckCount === 40);
}

console.log(`\n─── ${passed} assertions · all passed ───`);
