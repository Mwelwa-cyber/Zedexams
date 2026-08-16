"use strict";

/**
 * ACCEPTANCE 6 — a second guardian request inside 72 hours fails SERVER-SIDE,
 * not just client-side.
 *
 * The client's copy of the rule lives in `interruptionBudget` and runs on the
 * learner's device. A child who works out that clearing site data re-arms the
 * button must still not be able to put four messages in their parent's inbox
 * in an evening — that is how an app's messages become the thing a parent
 * blocks, and it takes the account with it.
 *
 * Plain `node`, like the rest of the functions suite: everything under test is
 * in `guardianUnlockCore`, which is pure by construction.
 */

const assert = require("node:assert/strict");

const {
  OUTCOME,
  REQUEST_COOLDOWN_MS,
  REQUESTABLE_GATES,
  buildProgressPayload,
  chooseQuotedPlan,
  decideRateLimit,
  resolveGuardianContact,
} = require("./guardianUnlockCore");

let failures = 0;
function test(name, fn) {
  try {
    const result = fn();
    // Every test here is synchronous, and this is what keeps it that way: a
    // promise returned into a sync try/catch settles after the block exits, so
    // an async test would log ✓ without ever running its assertions. Refusing
    // the shape is cheaper than discovering later that a test never ran.
    if (result && typeof result.then === "function") {
      throw new Error("test callback returned a promise — this runner is synchronous");
    }
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

const NOW = new Date("2026-08-19T10:00:00Z");
const HOUR = 60 * 60 * 1000;

console.log("\nguardian unlock — rate limit");

test("a learner who has never asked may ask", () => {
  const v = decideRateLimit(null, NOW);
  assert.equal(v.allowed, true);
  assert.equal(v.retryAfterMs, 0);
});

test("ACCEPTANCE 6 — a second request inside 72 hours is refused by the server", () => {
  const twoHoursAgo = new Date(NOW.getTime() - 2 * HOUR);
  const v = decideRateLimit(twoHoursAgo, NOW);
  assert.equal(v.allowed, false);
  assert.ok(v.retryAfterMs > 0);
  assert.ok(v.retryAfterMs <= REQUEST_COOLDOWN_MS);
});

test("the window is exactly 72 hours, open at the boundary", () => {
  assert.equal(REQUEST_COOLDOWN_MS, 72 * HOUR);
  assert.equal(decideRateLimit(new Date(NOW.getTime() - 72 * HOUR), NOW).allowed, true);
  assert.equal(decideRateLimit(new Date(NOW.getTime() - 71 * HOUR), NOW).allowed, false);
});

test("a Firestore Timestamp is accepted as well as a Date", () => {
  const stamp = {toDate: () => new Date(NOW.getTime() - 2 * HOUR)};
  assert.equal(decideRateLimit(stamp, NOW).allowed, false);
});

test("an unparseable last-request time is treated as never asked, not as blocked", () => {
  // Deliberately permissive: a corrupt timestamp must not permanently silence
  // a learner's only route to unlocking anything.
  assert.equal(decideRateLimit("not a date", NOW).allowed, true);
});

console.log("\nguardian unlock — who may be messaged");

test("fail closed: no guardian record, no contact, or a DENIED guardian", () => {
  assert.equal(resolveGuardianContact({}).reason, OUTCOME.NO_GUARDIAN);
  assert.equal(resolveGuardianContact({guardian: {}}).reason, OUTCOME.NO_GUARDIAN);
  assert.equal(
      resolveGuardianContact({guardian: {contact: "   "}}).reason,
      OUTCOME.NO_GUARDIAN,
  );
  // A guardian who already said no is not somebody to message again.
  assert.equal(
      resolveGuardianContact({
        guardian: {contact: "parent@example.com", consentStatus: "denied"},
      }).reason,
      OUTCOME.NO_GUARDIAN,
  );
});

test("a guardian on file resolves with their method", () => {
  const v = resolveGuardianContact({
    guardian: {contact: "parent@example.com", method: "email", consentStatus: "granted"},
  });
  assert.equal(v.ok, true);
  assert.equal(v.contact, "parent@example.com");
  assert.equal(v.method, "email");
  // Anything that is not the literal "whatsapp" is email — an unrecognised
  // method must not fall through to a channel we cannot actually deliver on.
  assert.equal(resolveGuardianContact({guardian: {contact: "x@y.z", method: "carrier-pigeon"}}).method, "email");
});

console.log("\nguardian unlock — the evidence");

test("nothing is invented: absent evidence is omitted, never substituted", () => {
  const p = buildProgressPayload({});
  assert.equal(p.score, null);
  assert.equal(p.outOf, null);
  assert.equal(p.streakDays, null);
  assert.equal(p.weakTopic, null);
  assert.equal(p.remaining, null);
});

test("a client-supplied score is accepted only when it is internally coherent", () => {
  const good = buildProgressPayload({clientContext: {score: 14, outOf: 20}});
  assert.equal(good.score, 14);
  assert.equal(good.outOf, 20);
  // A score above its own total, a negative score, or a zero total is not a
  // score. It falls back to the stored result rather than reaching a parent.
  for (const bad of [{score: 30, outOf: 20}, {score: -1, outOf: 20}, {score: 5, outOf: 0}]) {
    const p = buildProgressPayload({clientContext: bad});
    assert.equal(p.score, null, `${JSON.stringify(bad)} should be refused`);
  }
});

test("a stored result is used when the client offers nothing", () => {
  const p = buildProgressPayload({
    recentResults: [{score: 8, total: 10, subject: "Integrated Science"}],
  });
  assert.equal(p.score, 8);
  assert.equal(p.outOf, 10);
  assert.equal(p.subject, "Integrated Science");
});

console.log("\nguardian unlock — the quote");

test("the Term Pass is quoted outside the exam run-up", () => {
  const plan = chooseQuotedPlan(200, new Date("2026-03-01T00:00:00Z"));
  assert.equal(plan.checkoutPlanId, "term_pass");
  assert.equal(plan.price, 120);
});

test("the seasonal Exam Pass is quoted when the papers are close", () => {
  const plan = chooseQuotedPlan(47, new Date("2026-09-10T00:00:00Z"));
  assert.equal(plan.checkoutPlanId, "exam_pass");
  assert.equal(plan.price, 99);
});

test("an unknown countdown never produces the seasonal quote", () => {
  assert.equal(chooseQuotedPlan(null, new Date("2026-09-10T00:00:00Z")).checkoutPlanId, "term_pass");
});

console.log("\nguardian unlock — what may be requested");

test("the requestable gates are an allow-list, not a pass-through", () => {
  // The gate id reaches the message text a parent reads. A caller that could
  // name anything could put anything in front of them.
  assert.ok(REQUESTABLE_GATES.includes("PAPER_CONTINUE"));
  assert.ok(!REQUESTABLE_GATES.includes("TEACHER_AI_GEN"), "a teacher gate has no guardian");
  assert.ok(!REQUESTABLE_GATES.includes("<script>alert(1)</script>"));
  assert.ok(Object.isFrozen(REQUESTABLE_GATES));
});

console.log(failures === 0 ? "\nAll guardian-unlock tests passed." : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
