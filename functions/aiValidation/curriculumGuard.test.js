/**
 * Node test for functions/aiValidation/curriculumGuard.js — CBC/OBC framework,
 * grade and subject validation. No firebase deps.
 *
 * Run: node functions/aiValidation/curriculumGuard.test.js
 */

const assert = require("node:assert");
const {
  normalizeFramework, normalizeGrade, normalizeSubject,
  validateCurriculumContext,
} = require("./curriculumGuard");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const codes = (r) => r.issues.map((i) => i.code);

// ── normalizers ──────────────────────────────────────────────────────────────
ok("2023 → cbc", normalizeFramework("2023") === "cbc");
ok("2013 → obc", normalizeFramework("2013") === "obc");
ok("cbc string → cbc", normalizeFramework("CBC") === "cbc");
ok("unknown framework → ''", normalizeFramework("xyz") === "");
ok("Form 1 === G8", normalizeGrade("Form 1") === "G8" && normalizeGrade("G8") === "G8");
ok("Grade 4 variants match", normalizeGrade("Grade 4") === "G4" && normalizeGrade("G4") === "G4");
ok("nursery band", normalizeGrade("ECE_N") === "ECE_N" && normalizeGrade("Nursery") === "ECE_N");
ok("unknown grade → ''", normalizeGrade("banana") === "");
ok("subject normalises", normalizeSubject("Integrated Science") === "integrated_science");
ok("ampersand subject", normalizeSubject("Creative & Technology Studies") === "creative_and_technology_studies");
ok("numeracy != mathematics", normalizeSubject("Numeracy") !== normalizeSubject("Mathematics"));

// ── consistent context passes ────────────────────────────────────────────────
let r = validateCurriculumContext({
  response: {framework: "2023", header: {grade: "G4", subject: "integrated_science"}},
  selected: {framework: "2023", grade: "G4", subject: "integrated_science"},
});
ok("consistent context → no issues", r.issues.length === 0);

// response omits its coordinates → fail-open (unverifiable, not wrong)
r = validateCurriculumContext({
  response: {sections: [{questions: []}]},
  selected: {framework: "2023", grade: "G4", subject: "integrated_science"},
});
ok("omitted coordinates → fail-open (no issues)", r.issues.length === 0);

// ── the spec's headline example (§7) ─────────────────────────────────────────
// Selected: CBC 2023 / Grade 4 / Integrated Science
// Returned: OBC / Grade 7 / Natural Science → must be rejected.
r = validateCurriculumContext({
  response: {framework: "2013", grade: "G7", subject: "natural science"},
  selected: {framework: "2023", grade: "G4", subject: "integrated_science"},
});
ok("wrong framework flagged", codes(r).includes("FRAMEWORK_MISMATCH"));
ok("wrong grade flagged", codes(r).includes("GRADE_MISMATCH"));
ok("wrong subject flagged", codes(r).includes("SUBJECT_MISMATCH"));
ok("all mismatches are critical", r.issues.every((i) => i.severity === "critical"));

// ── framework field contamination (§8) ───────────────────────────────────────
// A CBC request must not come back carrying OBC-only "specificOutcomes".
r = validateCurriculumContext({
  response: {framework: "2023", specificOutcomes: ["SO1"], sections: []},
  selected: {framework: "2023", grade: "G5"},
});
ok("CBC response with OBC-only field → contamination", codes(r).includes("FRAMEWORK_FIELD_CONTAMINATION"));

// An OBC request must not come back carrying CBC-only "competencies".
r = validateCurriculumContext({
  response: {framework: "2013", competencies: ["C1"], expectedStandards: ["E1"]},
  selected: {framework: "2013", grade: "G5"},
});
ok("OBC response with CBC-only field → contamination", codes(r).includes("FRAMEWORK_FIELD_CONTAMINATION"));

// A CBC response carrying CBC fields is fine.
r = validateCurriculumContext({
  response: {framework: "2023", competencies: ["C1"], learningActivities: ["A1"]},
  selected: {framework: "2023"},
});
ok("CBC response with CBC fields → clean", r.issues.length === 0);

// contamination check is skippable
r = validateCurriculumContext({
  response: {framework: "2023", specificOutcomes: ["SO1"]},
  selected: {framework: "2023"},
  strictFramework: false,
});
ok("strictFramework:false skips contamination check", !codes(r).includes("FRAMEWORK_FIELD_CONTAMINATION"));

// ── Form vs Grade is not a mismatch when they mean the same level ────────────
r = validateCurriculumContext({
  response: {grade: "Form 1"},
  selected: {grade: "G8"},
});
ok("Form 1 vs G8 → NOT a mismatch", !codes(r).includes("GRADE_MISMATCH"));

// ── nested subject fields are found ──────────────────────────────────────────
r = validateCurriculumContext({
  response: {meta: {subject: "mathematics"}},
  selected: {subject: "numeracy"},
});
ok("nested subject mismatch caught (numeracy vs mathematics)", codes(r).includes("SUBJECT_MISMATCH"));

// ── no response object ───────────────────────────────────────────────────────
r = validateCurriculumContext({response: null, selected: {grade: "G4"}});
ok("null response → NO_RESPONSE critical", codes(r).includes("NO_RESPONSE"));

console.log(`\n${passed} assertions passed.`);
