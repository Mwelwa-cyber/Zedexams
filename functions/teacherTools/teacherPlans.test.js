/**
 * Unit tests for the teacher-plan catalogue (plan ids, limits, legacy alias
 * normalisation).
 *
 * Plain Node assertions, no test runner (repo convention). teacherPlans.js
 * is dependency-free, so this runs from the repo root without functions/
 * deps installed:
 *
 *   node functions/teacherTools/teacherPlans.test.js
 */

const assert = require("node:assert");
const {
  PLAN_LIMITS,
  PLAN_LABELS,
  LEGACY_PLAN_ALIASES,
  normalizeTeacherPlan,
} = require("./teacherPlans");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

console.log("teacherPlans");

// ── plan ids ─────────────────────────────────────────────────────────
test("catalogue carries exactly the canonical plan ids", () => {
  assert.deepStrictEqual(Object.keys(PLAN_LIMITS).sort(), ["free", "max", "pro"]);
});

test("legacy ids are NOT plan keys (they are aliases only)", () => {
  assert.ok(!("individual" in PLAN_LIMITS));
  assert.ok(!("school" in PLAN_LIMITS));
});

test("every plan has a human label", () => {
  for (const plan of Object.keys(PLAN_LIMITS)) {
    assert.strictEqual(typeof PLAN_LABELS[plan], "string");
    assert.ok(PLAN_LABELS[plan].length > 0);
  }
});

// ── normalizeTeacherPlan ─────────────────────────────────────────────
test("canonical ids pass through unchanged", () => {
  assert.strictEqual(normalizeTeacherPlan("free"), "free");
  assert.strictEqual(normalizeTeacherPlan("pro"), "pro");
  assert.strictEqual(normalizeTeacherPlan("max"), "max");
});

test("legacy individual maps to pro", () => {
  assert.strictEqual(normalizeTeacherPlan("individual"), "pro");
});

test("legacy school maps to max", () => {
  assert.strictEqual(normalizeTeacherPlan("school"), "max");
});

test("unknown / absent values normalise to null", () => {
  assert.strictEqual(normalizeTeacherPlan("premium"), null);
  assert.strictEqual(normalizeTeacherPlan(""), null);
  assert.strictEqual(normalizeTeacherPlan(null), null);
  assert.strictEqual(normalizeTeacherPlan(undefined), null);
  assert.strictEqual(normalizeTeacherPlan(42), null);
});

test("prototype keys are not treated as plans", () => {
  assert.strictEqual(normalizeTeacherPlan("toString"), null);
  assert.strictEqual(normalizeTeacherPlan("hasOwnProperty"), null);
  assert.strictEqual(normalizeTeacherPlan("constructor"), null);
});

test("every alias points at a real plan", () => {
  for (const [legacy, canonical] of Object.entries(LEGACY_PLAN_ALIASES)) {
    assert.ok(canonical in PLAN_LIMITS, `${legacy} → ${canonical} must exist`);
  }
});

// ── limits shape ─────────────────────────────────────────────────────
test("all plans meter the same tool set", () => {
  const freeTools = Object.keys(PLAN_LIMITS.free).sort();
  for (const plan of ["pro", "max"]) {
    assert.deepStrictEqual(
        Object.keys(PLAN_LIMITS[plan]).sort(),
        freeTools,
        `${plan} tool set must match free`,
    );
  }
});

test("every limit is a non-negative integer", () => {
  for (const [plan, tools] of Object.entries(PLAN_LIMITS)) {
    for (const [tool, limit] of Object.entries(tools)) {
      assert.ok(
          Number.isInteger(limit) && limit >= 0,
          `${plan}.${tool} = ${limit}`,
      );
    }
  }
});

test("paid tiers never offer less than free", () => {
  for (const tool of Object.keys(PLAN_LIMITS.free)) {
    assert.ok(PLAN_LIMITS.pro[tool] >= PLAN_LIMITS.free[tool], `pro.${tool}`);
    assert.ok(PLAN_LIMITS.max[tool] >= PLAN_LIMITS.pro[tool], `max.${tool} >= pro.${tool}`);
  }
});

// ── marketing-copy contract (src/components/marketing/Plans.jsx,
//    src/utils/subscriptionConfig.js pro_monthly features) ─────────────
test("pro limits match the published marketing numbers", () => {
  assert.strictEqual(PLAN_LIMITS.pro.lesson_plan, 40); // "40 lesson plans / month"
  assert.strictEqual(PLAN_LIMITS.pro.worksheet, 25); // "25 worksheets & teacher notes"
  assert.strictEqual(PLAN_LIMITS.pro.notes, 25);
  assert.strictEqual(PLAN_LIMITS.pro.quiz, 8); // "8 assessments / month"
  assert.strictEqual(PLAN_LIMITS.pro.scheme_of_work, 2); // "2 schemes of work / term"
});

test("free limits match the published marketing numbers", () => {
  assert.strictEqual(PLAN_LIMITS.free.lesson_plan, 5);
  assert.strictEqual(PLAN_LIMITS.free.worksheet, 3);
  assert.strictEqual(PLAN_LIMITS.free.notes, 3);
});

console.log(`\nteacherPlans: ${passed} tests passed`);
