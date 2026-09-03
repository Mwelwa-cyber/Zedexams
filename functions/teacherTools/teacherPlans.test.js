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
  DAILY_LIMITS,
  DAILY_COUNTED_TOOLS,
  MAX_ONLY_TOOLS,
  LEGACY_PLAN_ALIASES,
  TEACHER_TRIAL_DAYS,
  normalizeTeacherPlan,
  isDailyCountedTool,
  isMaxOnlyTool,
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
  assert.deepStrictEqual(Object.keys(PLAN_LIMITS).sort(), ["free", "max", "pro", "trial"]);
});

test("the free teacher trial is a plain alias of pro, never a diverging copy", () => {
  assert.strictEqual(PLAN_LIMITS.trial, PLAN_LIMITS.pro);
  assert.strictEqual(DAILY_LIMITS.trial, DAILY_LIMITS.pro);
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
  assert.strictEqual(normalizeTeacherPlan("trial"), "trial");
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
//    src/engines/payment-engine/subscriptionConfig.js pro_monthly features) ─────────────
test("pro limits match the published marketing numbers", () => {
  assert.strictEqual(PLAN_LIMITS.pro.lesson_plan, 40); // "40 lesson plans / month"
  assert.strictEqual(PLAN_LIMITS.pro.worksheet, 25); // "25 worksheets & teacher notes"
  assert.strictEqual(PLAN_LIMITS.pro.notes, 25);
  assert.strictEqual(PLAN_LIMITS.pro.quiz, 8); // formative quiz studio
  assert.strictEqual(PLAN_LIMITS.pro.scheme_of_work, 2); // "2 schemes of work / term"
});

// ── Max-anchored studios (exam paper only) ───────────────────────────
test("MAX_ONLY_TOOLS lists exactly the exam paper studio", () => {
  // Test Papers (assessment) is an allowance-based entitlement now, NOT a
  // Max-only lock — Pro gets complete papers, so only exam_paper anchors Max.
  assert.deepStrictEqual([...MAX_ONLY_TOOLS], ["exam_paper"]);
});

test("isMaxOnlyTool flags only the Exam Paper studio", () => {
  assert.ok(isMaxOnlyTool("exam_paper"));
  assert.ok(!isMaxOnlyTool("assessment"));
  assert.ok(!isMaxOnlyTool("lesson_plan"));
  assert.ok(!isMaxOnlyTool("worksheet"));
});

test("Test Papers ladder: Free previews → Pro complete → Max heavy", () => {
  // Free 2 five-question previews, Pro 3 COMPLETE papers, Max heavy — a real
  // Free→Pro→Max progression (Option 2 catalogue decision).
  assert.strictEqual(PLAN_LIMITS.free.assessment, 2, "free.assessment previews");
  assert.strictEqual(PLAN_LIMITS.pro.assessment, 3, "pro.assessment complete papers");
  assert.ok(PLAN_LIMITS.max.assessment > PLAN_LIMITS.pro.assessment, "max > pro");
  // Exam papers remain the classic Max-anchor: locked on Free, one Pro taster.
  assert.strictEqual(PLAN_LIMITS.free.exam_paper, 0, "free.exam_paper locked");
  assert.strictEqual(PLAN_LIMITS.pro.exam_paper, 1, "pro.exam_paper taster");
});

test("max unlocks the Max studios well beyond the taster", () => {
  for (const tool of MAX_ONLY_TOOLS) {
    assert.ok(PLAN_LIMITS.max[tool] > 1, `max.${tool} must exceed the taster`);
  }
});

test("every Max-only tool is a registered, daily-counted tool", () => {
  for (const tool of MAX_ONLY_TOOLS) {
    assert.ok(tool in PLAN_LIMITS.free, `${tool} must exist in PLAN_LIMITS`);
    assert.ok(isDailyCountedTool(tool), `${tool} should count daily`);
  }
});

test("free runs the weekly loop in limited form; everything else stays locked", () => {
  // The limited free tier (dashboard redesign §12): the weekly teaching loop
  // in preview form. Weekly-feeling allowances expressed monthly (~4 weeks).
  assert.strictEqual(PLAN_LIMITS.free.lesson_plan, 8);
  assert.strictEqual(PLAN_LIMITS.free.worksheet, 4);
  assert.strictEqual(PLAN_LIMITS.free.homework, 4);
  assert.strictEqual(PLAN_LIMITS.free.assessment, 2); // 5-question previews
  assert.strictEqual(PLAN_LIMITS.free.scheme_of_work, 2); // 2-week previews
  // Tools that stay funded on Free even though they aren't full studios: the
  // quiz-editor micro-helpers, the Lesson Plan studio's AI section-editor,
  // and the in-studio diagram tool.
  const openOnFree = new Set([
    "lesson_plan", "worksheet", "homework", "assessment", "scheme_of_work",
    "suggest_answer", "revise_question", "revise_lesson_section", "diagram",
  ]);
  for (const [tool, limit] of Object.entries(PLAN_LIMITS.free)) {
    if (openOnFree.has(tool)) {
      assert.ok(limit > 0, `free.${tool} stays funded`);
    } else {
      assert.strictEqual(limit, 0, `free.${tool} must be locked (sample only)`);
    }
  }
});

// ── free-preview shaping (enforced inside the generators) ────────────
test("FREE_PREVIEW_LIMITS pins the preview shape", () => {
  const {FREE_PREVIEW_LIMITS} = require("./teacherPlans");
  assert.strictEqual(FREE_PREVIEW_LIMITS.schemePreviewWeeks, 2);
  assert.strictEqual(FREE_PREVIEW_LIMITS.maxShortTestQuestions, 5);
  assert.ok(FREE_PREVIEW_LIMITS.shortTestMarksCap >= 5);
});

// ── daily caps (marketing: "Daily cap of 2/10/30 generations") ───────
test("daily limits cover exactly the canonical plans", () => {
  assert.deepStrictEqual(Object.keys(DAILY_LIMITS).sort(), ["free", "max", "pro", "trial"]);
});

test("daily limits match the published marketing numbers", () => {
  assert.strictEqual(DAILY_LIMITS.free, 2);
  assert.strictEqual(DAILY_LIMITS.pro, 10);
  assert.strictEqual(DAILY_LIMITS.max, 30);
});

test("daily limits are positive and rank free < pro < max", () => {
  assert.ok(DAILY_LIMITS.free > 0);
  assert.ok(DAILY_LIMITS.pro > DAILY_LIMITS.free);
  assert.ok(DAILY_LIMITS.max > DAILY_LIMITS.pro);
});

test("every daily-counted tool is a registered tool", () => {
  for (const tool of DAILY_COUNTED_TOOLS) {
    assert.ok(tool in PLAN_LIMITS.free, `${tool} must exist in PLAN_LIMITS`);
  }
});

test("studio generators count toward the daily cap", () => {
  for (const tool of [
    "lesson_plan", "worksheet", "quiz", "assessment", "exam_paper",
    "scheme_of_work", "notes", "homework", "rubric",
    "flashcards", "diagram", "slide_notes",
  ]) {
    assert.ok(isDailyCountedTool(tool), `${tool} should count daily`);
  }
});

test("micro tools are exempt from the daily cap", () => {
  // Their monthly allowances (pro suggest_answer: 500/month ≈ 16/day)
  // could not coexist with a 10/day total cap.
  for (const tool of ["suggest_answer", "revise_question", "slide_notes_images"]) {
    assert.ok(!isDailyCountedTool(tool), `${tool} must NOT count daily`);
  }
});

test("exempt micro tools really do exceed the daily cap monthly", () => {
  // Guards the rationale above: if a future limit change drops a micro
  // tool's monthly allowance to within the daily cap, revisit its exemption.
  // ×3 = a tool must allow at least 3 full cap-days' worth per month before
  // exempting it makes sense (today's smallest: slide_notes_images 60 ≈ 6×).
  const exempt = Object.keys(PLAN_LIMITS.free).filter((t) => !isDailyCountedTool(t));
  for (const tool of exempt) {
    assert.ok(
        PLAN_LIMITS.pro[tool] > DAILY_LIMITS.pro * 3,
        `${tool} monthly allowance no longer dwarfs the daily cap — re-check exemption`,
    );
  }
});

test("TEACHER_TRIAL_DAYS is a sane positive integer", () => {
  assert.ok(Number.isInteger(TEACHER_TRIAL_DAYS));
  assert.ok(TEACHER_TRIAL_DAYS > 0 && TEACHER_TRIAL_DAYS <= 30);
});

console.log(`\nteacherPlans: ${passed} tests passed`);
