/**
 * Node test for functions/agents/publicStatusCore.js.
 * Run: node functions/agents/publicStatusCore.test.js
 *
 * Asserts the Vigil-report → public-status mapping: rich states, core-vs-non-core
 * outage escalation, and the streak rules (show a failure immediately; only
 * declare recovery after RECOVERY_THRESHOLD clean runs — no flapping to green).
 */

const assert = require("node:assert");
const {
  buildPublicStatus,
  STATUS,
  RECOVERY_THRESHOLD,
} = require("./publicStatusCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("publicStatusCore");

const allOkChecks = {
  pages: {ok: true}, firebase: {ok: true}, quizzes: {ok: true},
  images: {ok: true}, dailyExams: {ok: true}, playBilling: {ok: true},
};
const report = (overrides = {}) => ({
  ranAt: "2026-07-20T10:00:00Z",
  ok: true,
  counts: {total: 0, critical: 0, warning: 0},
  checks: {...allOkChecks, ...(overrides.checks || {})},
  failures: overrides.failures || [],
});

// 1. All healthy → operational everywhere.
{
  const doc = buildPublicStatus(report(), null, {nowMs: 1000});
  ok("all healthy → overall operational", doc.overall === STATUS.OPERATIONAL);
  ok("all healthy → ok true", doc.ok === true);
  ok("all components operational", Object.values(doc.components).every((c) => c.status === STATUS.OPERATIONAL));
  ok("stamps generatedAt", doc.generatedAt === 1000);
}

// 2. Core surface (pages) critical → major outage.
{
  const doc = buildPublicStatus(report({
    checks: {pages: {ok: false}},
    failures: [{check: "pages", severity: "critical"}],
  }), null, {nowMs: 2000});
  ok("pages critical → pages major_outage", doc.components.pages.status === STATUS.MAJOR_OUTAGE);
  ok("pages critical → overall major_outage", doc.overall === STATUS.MAJOR_OUTAGE);
  ok("failure shows on the FIRST run (threshold 1)", doc.components.pages.consecutiveFail === 1);
}

// 3. Non-core surface (playBilling) critical → partial outage.
{
  const doc = buildPublicStatus(report({
    checks: {playBilling: {ok: false}},
    failures: [{check: "playBilling", severity: "critical"}],
  }), null, {nowMs: 3000});
  ok("playBilling critical → partial_outage", doc.components.playBilling.status === STATUS.PARTIAL_OUTAGE);
  ok("non-core critical → overall partial_outage", doc.overall === STATUS.PARTIAL_OUTAGE);
}

// 4. Warning → degraded.
{
  const doc = buildPublicStatus(report({
    checks: {images: {ok: false}},
    failures: [{check: "images", severity: "warning"}],
  }), null, {nowMs: 4000});
  ok("images warning → degraded", doc.components.images.status === STATUS.DEGRADED);
  ok("only-warning → overall degraded", doc.overall === STATUS.DEGRADED);
}

// 5. Recovery requires RECOVERY_THRESHOLD clean runs (no flap to green).
{
  ok("recovery threshold is > 1", RECOVERY_THRESHOLD >= 2);
  // Run A: pages down.
  const down = buildPublicStatus(report({
    checks: {pages: {ok: false}},
    failures: [{check: "pages", severity: "critical"}],
  }), null, {nowMs: 5000});
  ok("run A: pages down", down.components.pages.status === STATUS.MAJOR_OUTAGE);

  // Run B: pages ok again — first clean run must NOT immediately show operational.
  const recovering = buildPublicStatus(report(), down, {nowMs: 6000});
  ok("run B: first clean run reads recovering (degraded)", recovering.components.pages.status === STATUS.DEGRADED);
  ok("run B: recovering flag set", recovering.components.pages.recovering === true);
  ok("run B: overall not yet operational", recovering.overall !== STATUS.OPERATIONAL);

  // Run C: second consecutive clean run → confirmed operational.
  const confirmed = buildPublicStatus(report(), recovering, {nowMs: 7000});
  ok("run C: confirmed operational after 2 clean runs", confirmed.components.pages.status === STATUS.OPERATIONAL);
  ok("run C: overall operational", confirmed.overall === STATUS.OPERATIONAL);
}

// 6. Streaks accumulate across repeated failures.
{
  const r = report({checks: {firebase: {ok: false}}, failures: [{check: "firebase", severity: "critical"}]});
  const a = buildPublicStatus(r, null, {nowMs: 8000});
  const b = buildPublicStatus(r, a, {nowMs: 9000});
  ok("repeated failure accumulates streak", b.components.firebase.consecutiveFail === 2);
  ok("repeated failure stays down", b.components.firebase.status === STATUS.MAJOR_OUTAGE);
}

console.log(`\n${passed} assertions passed.`);
