/**
 * Plain-node tests for the v3 lesson plan validator (official CDC
 * teaching-module structure). Run directly:
 *
 *   node functions/teacherTools/lessonPlanSchema.test.js
 *
 * Throws (exit 1) on the first failed assertion, exits 0 when green —
 * same convention as the other functions/ tests wired into `test:all`.
 */

const assert = require("node:assert");
const {
  SCHEMA_VERSION,
  validateLessonPlan,
  detectSchemaVersion,
} = require("./lessonPlanSchema");

function officialStage(name, mins) {
  return {
    name,
    durationMinutes: mins,
    teacherActivities: ["Ask learners a hook question."],
    learnerActivities: ["Respond to the question."],
    assessmentCriteria: ["Learners respond correctly."],
  };
}

function validPlan() {
  return {
    header: {
      school: "Mwelu Mantimpa Primary",
      teacherName: "Mwamba Chanda",
      date: "2026-06-10",
      time: "07:30",
      durationMinutes: 30,
      class: "Grade 2",
      subject: "Creative and Technology Studies",
      topic: "2.10 Tourism",
      subtopic: "2.10.1 Attraction Sites",
      termAndWeek: "Term 1, Week 5",
      boysPresent: 32,
      girlsPresent: 43,
    },
    generalCompetences: ["Citizenship", "Communication", "Environmental Sustainability"],
    specificCompetence: "2.10.1.1 Explore local attraction sites",
    lessonGoal: "To enable learners explore local attraction sites and appreciate their importance to the community.",
    rationale: "This lesson focuses on tourism attraction sites. Group work and discovery methods will be used. This is lesson 1 in a series of 2.",
    priorKnowledge: "Learners have visited or watched a trading place, city or museum.",
    references: ["Lower Primary Syllabus, CTS, page 87.", "CTS Teaching Module Grade 2, page 87."],
    learningEnvironment: {
      natural: "School surroundings and the local community.",
      artificial: "Classroom with a tourism corner.",
      technological: "Video clip shown on a phone or projector.",
    },
    materials: ["Pictures of local attraction sites", "Video clip", "Brochures"],
    expectedStandard: "Local attraction sites explored accordingly.",
    keyVocabulary: ["Tourism: visiting interesting places to learn and enjoy."],
    stages: [
      officialStage("INTRODUCTION", 5),
      officialStage("LESSON DEVELOPMENT", 15),
      officialStage("EXERCISE / ASSESSMENT", 5),
      officialStage("HOMEWORK", 2),
      officialStage("CONCLUSION", 3),
    ],
    remedialWork: "Learners who struggled review the picture cards with the teacher.",
    extensionActivity: "Fast finishers design a small poster.",
    coveredContent: ["Identifying local attraction sites"],
  };
}

// ── happy path ────────────────────────────────────────────────────────
{
  const res = validateLessonPlan(validPlan());
  assert.strictEqual(res.ok, true, `expected ok, got errors: ${res.errors}`);
  assert.strictEqual(res.value.schemaVersion, SCHEMA_VERSION);
  assert.strictEqual(res.value.header.totalPupils, 75, "totalPupils derived from boys + girls");
  assert.strictEqual(res.value.stages.length, 5);
  assert.strictEqual(res.value.stages[0].name, "INTRODUCTION");
  assert.strictEqual(res.value.expectedStandard, "Local attraction sites explored accordingly.");
}

// ── stage names are normalised to upper case ─────────────────────────
{
  const plan = validPlan();
  plan.stages[0].name = "Introduction";
  const res = validateLessonPlan(plan);
  assert.strictEqual(res.ok, true, `expected ok, got errors: ${res.errors}`);
  assert.strictEqual(res.value.stages[0].name, "INTRODUCTION");
}

// ── LESSON DEVELOPMENT split into activities still satisfies the
//    official-stage check (prefix match) ───────────────────────────────
{
  const plan = validPlan();
  plan.stages.splice(1, 1,
      officialStage("LESSON DEVELOPMENT — Activity 1: Reading numbers", 8),
      officialStage("LESSON DEVELOPMENT — Activity 2: Writing numbers", 7));
  const res = validateLessonPlan(plan);
  assert.strictEqual(res.ok, true, `expected ok, got errors: ${res.errors}`);
  assert.strictEqual(res.value.stages.length, 6);
}

// ── missing essentials are reported ──────────────────────────────────
{
  const plan = validPlan();
  delete plan.specificCompetence;
  delete plan.expectedStandard;
  plan.materials = [];
  const res = validateLessonPlan(plan);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("specificCompetence")), "flags specificCompetence");
  assert.ok(res.errors.some((e) => e.includes("expectedStandard")), "flags expectedStandard");
  assert.ok(res.errors.some((e) => e.includes("materials")), "flags materials");
}

// ── missing official stages are reported ─────────────────────────────
{
  const plan = validPlan();
  plan.stages = [officialStage("INTRODUCTION", 5), officialStage("CONCLUSION", 5)];
  const res = validateLessonPlan(plan);
  assert.strictEqual(res.ok, false);
  assert.ok(
      res.errors.some((e) => e.includes("LESSON DEVELOPMENT") && e.includes("HOMEWORK")),
      `expected missing-stage error, got: ${res.errors}`);
}

// ── empty stages array is rejected ───────────────────────────────────
{
  const plan = validPlan();
  plan.stages = [];
  const res = validateLessonPlan(plan);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("stages")));
}

// ── detectSchemaVersion across all three generations ─────────────────
{
  assert.strictEqual(detectSchemaVersion(validPlan()), "3.0");
  assert.strictEqual(detectSchemaVersion({lessonProgression: {engagement: {}}}), "2.0");
  assert.strictEqual(detectSchemaVersion({lessonDevelopment: {introduction: {}}}), "1.0");
  assert.strictEqual(detectSchemaVersion({schemaVersion: "2.0"}), "2.0");
  assert.strictEqual(detectSchemaVersion(null), "1.0");
}

console.log("lessonPlanSchema.test.js — all assertions passed");
