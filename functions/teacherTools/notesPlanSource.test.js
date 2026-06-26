/**
 * Node test for the Teacher Notes "source lesson plan" resolver.
 * Run: node functions/teacherTools/notesPlanSource.test.js
 *
 * Guards the regression where picking a lesson plan in the Notes Studio
 * failed with "That generation isn't a lesson plan we can build notes
 * from." — the server only accepted `tool === "lesson_plan"` with a
 * top-level `output`, rejecting (a) legacy studio plans (tool
 * "lesson-plan", body under `data`) and (b) plans still generating.
 */

const assert = require("node:assert");
const {
  isLessonPlanTool,
  lessonPlanBody,
  deriveInputsFromLessonPlan,
} = require("./notesPlanSource");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("notesPlanSource");

// ── isLessonPlanTool: accepts both the canonical and legacy tool names ──
ok("accepts canonical lesson_plan", isLessonPlanTool("lesson_plan") === true);
ok("accepts legacy lesson-plan", isLessonPlanTool("lesson-plan") === true);
ok("rejects worksheet", isLessonPlanTool("worksheet") === false);
ok("rejects notes", isLessonPlanTool("notes") === false);
ok("rejects empty/undefined",
  isLessonPlanTool("") === false && isLessonPlanTool(undefined) === false);

// ── lessonPlanBody: pulls the body from output OR legacy data ───────────
ok("reads Cloud Functions output",
  lessonPlanBody({output: {header: {topic: "Fractions"}}}).header.topic ===
    "Fractions");
ok("falls back to legacy data",
  lessonPlanBody({tool: "lesson-plan", data: {lessonGoal: "x"}}).lessonGoal ===
    "x");
ok("prefers output over data",
  lessonPlanBody({output: {a: 1}, data: {a: 2}}).a === 1);
ok("returns null when still generating (output null)",
  lessonPlanBody({status: "generating", output: null}) === null);
ok("returns null when failed (no body at all)",
  lessonPlanBody({status: "failed"}) === null);
ok("returns null for non-object body",
  lessonPlanBody({output: "not an object"}) === null);
ok("returns null for null/undefined plan",
  lessonPlanBody(null) === null && lessonPlanBody(undefined) === null);

// ── deriveInputsFromLessonPlan: fills missing fields, never clobbers ────
const EMPTY_BASE = {
  grade: "", subject: "", topic: "", subtopic: "",
  durationMinutes: 40, language: "english", teacherName: "", school: "",
};

const fromOutput = deriveInputsFromLessonPlan(
  {
    tool: "lesson_plan",
    inputs: {grade: "G3", subject: "mathematics"},
    output: {header: {topic: "Hardware", subtopic: "Computer Hardware"}},
  },
  {...EMPTY_BASE},
);
ok("fills grade from plan inputs", fromOutput.grade === "G3");
ok("fills subject from plan inputs", fromOutput.subject === "mathematics");
ok("fills topic from output header", fromOutput.topic === "Hardware");
ok("fills subtopic from output header",
  fromOutput.subtopic === "Computer Hardware");

// Legacy studio doc: no `inputs`/`output`, body + fields live under
// `data`/`meta`. This is the shape that used to be wrongly rejected.
const fromLegacy = deriveInputsFromLessonPlan(
  {
    tool: "lesson-plan",
    meta: {klass: "G5", subject: "english", topic: "Verbs"},
    data: {lessonGoal: "Use verbs"},
  },
  {...EMPTY_BASE},
);
ok("fills grade from legacy meta.klass", fromLegacy.grade === "G5");
ok("fills subject from legacy meta", fromLegacy.subject === "english");
ok("fills topic from legacy meta", fromLegacy.topic === "Verbs");

ok("never clobbers a value already in base",
  deriveInputsFromLessonPlan(
    {output: {header: {topic: "Plan topic"}}},
    {...EMPTY_BASE, topic: "Teacher topic"},
  ).topic === "Teacher topic");

ok("returns base unchanged when plan has no body",
  deriveInputsFromLessonPlan({status: "generating", output: null},
    {...EMPTY_BASE, topic: "kept"}).topic === "kept");

console.log(`\nnotesPlanSource: ${passed} assertions passed`);
