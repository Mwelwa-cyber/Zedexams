/**
 * Plain-node tests for lessonPlanPrompt.js and the sanitizeInputs helper
 * in generateLessonPlan.js.
 *
 * Run: node functions/teacherTools/lessonPlanPrompt.test.js
 */

"use strict";

const assert = require("node:assert");

// ── Stub dependencies that generateLessonPlan.js pulls in ────────────────────
// We only need sanitizeInputs, which has no runtime dependencies beyond the
// LEARNING_ENVIRONMENT_VALUES list.  Stub out everything else so the module
// loads cleanly without firebase-admin, firebase-functions, etc.

const Module = require("node:module");
const originalLoad = Module._load.bind(Module);
Module._load = function(id, parent, isMain) {
  if (id === "firebase-admin") {
    return {firestore: () => ({collection: () => ({doc: () => ({set: async () => {}})})})};
  }
  if (id === "firebase-functions/v2/https") {
    const HttpsError = class extends Error {
      constructor(code, msg) { super(msg); this.code = code; }
    };
    return {onCall: () => () => {}, HttpsError};
  }
  if (id === "../aiService") {
    return {getAnthropicApiKey: () => "", getUserRole: async () => "teacher", isStaffRole: () => true};
  }
  if (id === "./anthropicClient") {
    return {callClaude: async () => ({parsed: {}, text: "", usage: {}})};
  }
  if (id === "./cbcKnowledge") {
    return {resolveCbcContext: async () => ({contextBlock: "", kbMatch: null, kbWarning: null, kbVersion: "0"})};
  }
  if (id === "./lessonPlanSchema") {
    return {validateLessonPlan: (p) => ({ok: true, value: p, errors: []})};
  }
  if (id === "./usageMeter") {
    return {assertAndIncrement: async () => ({plan: "free", used: 0, limit: 10})};
  }
  return originalLoad(id, parent, isMain);
};

const {buildUserPrompt} = require("./lessonPlanPrompt");
const {sanitizeInputs} = require("./generateLessonPlan");

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, `FAIL: ${name}`);
  passed++;
  console.log(`  ok  ${name}`);
}

function baseInputs(overrides = {}) {
  return {
    grade: "G5",
    subject: "science",
    topic: "The Environment",
    subtopic: "Environmental Management",
    ...overrides,
  };
}

// ── buildUserPrompt — CBC (default) ──────────────────────────────────────────

console.log("\nbuildUserPrompt — CBC mode");

{
  const prompt = buildUserPrompt(baseInputs({
    curriculumMode: "cbc",
    specificCompetence: "4.3.1.1 Manage natural resources",
    learningActivities: ["Sort litter", "Observe a pond"],
    expectedStandard: "Natural resources managed correctly.",
  }));

  ok("CBC: opens with 'Generate a Zambian CBC'", prompt.startsWith("Generate a Zambian CBC"));
  ok("CBC: contains <cbc_context> tag", prompt.includes("<cbc_context>"));
  ok("CBC: contains specificCompetence value", prompt.includes("4.3.1.1 Manage natural resources"));
  ok("CBC: learning activities joined with ' | '", prompt.includes("Sort litter | Observe a pond"));
  ok("CBC: contains expectedStandard", prompt.includes("Natural resources managed correctly."));
  ok("CBC: contains </cbc_context> closing tag", prompt.includes("</cbc_context>"));
  ok("CBC: grounding instruction present", prompt.includes("specificCompetence drives every stage"));
  ok("CBC: does NOT contain <previous_context>", !prompt.includes("<previous_context>"));
}

// ── buildUserPrompt — CBC default (no curriculumMode set) ────────────────────

console.log("\nbuildUserPrompt — default (no curriculumMode)");

{
  const prompt = buildUserPrompt(baseInputs({
    specificCompetence: "4.1.1.1 Practise safe food handling",
    learningActivities: ["Wash hands", "Examine food labels"],
    expectedStandard: "Safe food handling practised.",
  }));

  ok("default: opens with 'Generate a Zambian CBC' (backward compat)", prompt.startsWith("Generate a Zambian CBC"));
  ok("default: <cbc_context> present", prompt.includes("<cbc_context>"));
  ok("default: no <previous_context>", !prompt.includes("<previous_context>"));
}

// ── buildUserPrompt — Previous Curriculum ────────────────────────────────────

console.log("\nbuildUserPrompt — Previous Curriculum mode");

{
  const prompt = buildUserPrompt(baseInputs({
    curriculumMode: "previous",
    selectedOutcomes: [
      "Identify the main parts of a plant.",
      "Describe the function of roots.",
    ],
  }));

  ok("prev: opening line contains 'Previous Curriculum'", prompt.includes("Previous Curriculum"));
  ok("prev: does NOT say 'Generate a Zambian CBC'", !prompt.includes("Generate a Zambian CBC lesson plan for"));
  ok("prev: contains <previous_context>", prompt.includes("<previous_context>"));
  ok("prev: outcome 1 numbered correctly", prompt.includes("1. Identify the main parts of a plant."));
  ok("prev: outcome 2 numbered correctly", prompt.includes("2. Describe the function of roots."));
  ok("prev: grounding instruction for outcomes present", prompt.includes("Ground the lesson in achieving these specific outcomes"));
  ok("prev: stage names mention Introduction → Development", prompt.includes("Introduction → Development"));
  ok("prev: does NOT contain <cbc_context>", !prompt.includes("<cbc_context>"));
}

// ── buildUserPrompt — coveredActivities ──────────────────────────────────────

console.log("\nbuildUserPrompt — coveredActivities");

{
  const prompt = buildUserPrompt(baseInputs({
    curriculumMode: "cbc",
    specificCompetence: "4.3.1.1 Manage natural resources",
    learningActivities: ["Sort litter"],
    expectedStandard: "Resources managed.",
    coveredActivities: ["Types of natural resources", "Water cycle basics"],
    lessonFocus: "Land degradation and soil erosion",
  }));

  ok("coveredActivities: DO NOT repeat line present", prompt.includes("DO NOT repeat"));
  ok("coveredActivities: activities joined with ' | '", prompt.includes("Types of natural resources | Water cycle basics"));
  ok("coveredActivities: lessonFocus present", prompt.includes("Land degradation and soil erosion"));
}

{
  // coveredActivities with no lessonFocus should fall back to default text
  const prompt = buildUserPrompt(baseInputs({
    curriculumMode: "cbc",
    specificCompetence: "4.3.1.1 Manage natural resources",
    learningActivities: [],
    expectedStandard: "",
    coveredActivities: ["Water cycle"],
  }));

  ok("coveredActivities: fallback focus text present", prompt.includes("Continue from covered content above"));
}

// ── buildUserPrompt — Previous Curriculum with coveredActivities emitted ──────

console.log("\nbuildUserPrompt — Previous Curriculum emits coveredActivities block");

{
  // coveredActivities block now fires for both CBC and Previous mode
  const prompt = buildUserPrompt(baseInputs({
    curriculumMode: "previous",
    selectedOutcomes: ["Name three types of soil."],
    coveredActivities: ["Clay soil properties"],
    lessonFocus: "Sandy soil and loam",
  }));

  ok("prev: coveredActivities block IS emitted in previous mode", prompt.includes("DO NOT repeat"));
  ok("prev: coveredActivities content included", prompt.includes("Clay soil properties"));
  ok("prev: lessonFocus included in previous mode", prompt.includes("Sandy soil and loam"));
}

// ── buildUserPrompt — resourceLevel (school equipment) ───────────────────────

console.log("\nbuildUserPrompt — resourceLevel");

{
  const prompt = buildUserPrompt(baseInputs({resourceLevel: "low"}));
  ok("resourceLevel low: LOW-RESOURCE line present", prompt.includes("LOW-RESOURCE RURAL SCHOOL"));
  ok("resourceLevel low: hard constraint present", prompt.includes("HARD CONSTRAINT"));
  ok("resourceLevel low: forbids printing/projection", prompt.includes("Do NOT include any activity that needs printing"));
}

{
  const prompt = buildUserPrompt(baseInputs({resourceLevel: "basic"}));
  ok("resourceLevel basic: BASIC line present", prompt.includes("School resources: BASIC"));
  ok("resourceLevel basic: no low-resource hard constraint", !prompt.includes("HARD CONSTRAINT"));
}

{
  const prompt = buildUserPrompt(baseInputs({resourceLevel: "full"}));
  ok("resourceLevel full: WELL-RESOURCED line present", prompt.includes("WELL-RESOURCED"));
}

{
  const prompt = buildUserPrompt(baseInputs());
  ok("resourceLevel absent: no School resources line", !prompt.includes("School resources:"));
}

// ── sanitizeInputs — new fields ───────────────────────────────────────────────

console.log("\nsanitizeInputs — new curriculum fields");

{
  const result = sanitizeInputs({
    grade: "G5",
    subject: "mathematics",
    topic: "Fractions",
    curriculumMode: "cbc",
    specificCompetence: "Add fractions with unlike denominators",
    learningActivities: ["Cut paper into fractions", "Compare parts"],
    expectedStandard: "Fractions added correctly.",
    selectedOutcomes: [],
    coveredActivities: ["Equivalent fractions"],
    lessonFocus: "Adding unlike denominators",
  });

  ok("sanitize: curriculumMode 'cbc' passes through", result.curriculumMode === "cbc");
  ok("sanitize: specificCompetence passes through", result.specificCompetence === "Add fractions with unlike denominators");
  ok("sanitize: learningActivities is array", Array.isArray(result.learningActivities));
  ok("sanitize: learningActivities length preserved", result.learningActivities.length === 2);
  ok("sanitize: expectedStandard passes through", result.expectedStandard === "Fractions added correctly.");
  ok("sanitize: selectedOutcomes is empty array", Array.isArray(result.selectedOutcomes) && result.selectedOutcomes.length === 0);
  ok("sanitize: coveredActivities passes through", result.coveredActivities[0] === "Equivalent fractions");
  ok("sanitize: lessonFocus passes through", result.lessonFocus === "Adding unlike denominators");
}

{
  const result = sanitizeInputs({
    grade: "G6",
    subject: "science",
    topic: "Plants",
    curriculumMode: "previous",
    selectedOutcomes: ["Identify parts of a flower.", "Label a diagram."],
  });

  ok("sanitize: curriculumMode 'previous' passes through", result.curriculumMode === "previous");
  ok("sanitize: selectedOutcomes length preserved", result.selectedOutcomes.length === 2);
}

{
  // Invalid curriculumMode should default to 'cbc'
  const result = sanitizeInputs({
    grade: "G4",
    subject: "english",
    topic: "Nouns",
    curriculumMode: "unknown_mode",
  });

  ok("sanitize: invalid curriculumMode defaults to 'cbc'", result.curriculumMode === "cbc");
}

{
  // Null/missing curriculumMode should default to 'cbc'
  const result = sanitizeInputs({grade: "G4", subject: "english", topic: "Nouns"});
  ok("sanitize: absent curriculumMode defaults to 'cbc'", result.curriculumMode === "cbc");
}

{
  // resourceLevel: allowlisted values pass, anything else becomes ""
  const low = sanitizeInputs({grade: "G4", subject: "english", topic: "Nouns", resourceLevel: "LOW"});
  ok("sanitize: resourceLevel 'LOW' normalised to 'low'", low.resourceLevel === "low");
  const bogus = sanitizeInputs({grade: "G4", subject: "english", topic: "Nouns", resourceLevel: "mega"});
  ok("sanitize: unknown resourceLevel becomes ''", bogus.resourceLevel === "");
  const absent = sanitizeInputs({grade: "G4", subject: "english", topic: "Nouns"});
  ok("sanitize: absent resourceLevel becomes ''", absent.resourceLevel === "");
}

{
  // Non-array learningActivities / selectedOutcomes / coveredActivities should become []
  const result = sanitizeInputs({
    grade: "G4",
    subject: "english",
    topic: "Nouns",
    learningActivities: "not an array",
    selectedOutcomes: 42,
    coveredActivities: null,
  });

  ok("sanitize: non-array learningActivities becomes []", Array.isArray(result.learningActivities) && result.learningActivities.length === 0);
  ok("sanitize: non-array selectedOutcomes becomes []", Array.isArray(result.selectedOutcomes) && result.selectedOutcomes.length === 0);
  ok("sanitize: null coveredActivities becomes []", Array.isArray(result.coveredActivities) && result.coveredActivities.length === 0);
}

{
  // Strings exceeding max length should be truncated
  const longString = "x".repeat(400);
  const result = sanitizeInputs({
    grade: "G4",
    subject: "english",
    topic: "Nouns",
    specificCompetence: longString,
    expectedStandard: longString,
    lessonFocus: "x".repeat(300),
  });

  ok("sanitize: specificCompetence truncated to 300", result.specificCompetence.length === 300);
  ok("sanitize: expectedStandard truncated to 300", result.expectedStandard.length === 300);
  ok("sanitize: lessonFocus truncated to 200", result.lessonFocus.length === 200);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} tests passed.\n`);
