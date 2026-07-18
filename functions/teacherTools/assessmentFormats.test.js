/**
 * Node test for the assessment format resolver's pure logic:
 * grade→band mapping and deterministic profile matching.
 * Run: node functions/teacherTools/assessmentFormats.test.js
 */

const assert = require("node:assert");
const {
  gradeToBand,
  matchFormatProfile,
  buildFormatId,
  validateFormatProfile,
  renderFormatContextBlock,
  ASSESSMENT_TYPES,
  ASSESSMENT_TYPE_LABELS,
  FORMAT_TYPE_ALIASES,
  DEFAULT_PROFILE,
  GENERIC_SUBJECT,
} = require("./assessmentFormats");
const {FORMAT_PROFILES} = require("./assessmentFormatSeeds");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentFormats");

// ── gradeToBand ───────────────────────────────────────────────────────────
{
  const cases = [
    ["ECE", "lower_primary"],
    ["G1", "lower_primary"], ["G3", "lower_primary"],
    ["G4", "upper_primary"], ["G7", "upper_primary"],
    ["G8", "junior_secondary"], ["G9", "junior_secondary"],
    ["F1", "junior_secondary"], ["F2", "junior_secondary"],
    ["G10", "senior_secondary"], ["G12", "senior_secondary"],
    ["F3", "senior_secondary"], ["F4", "senior_secondary"],
    ["g5", "upper_primary"], // case-insensitive
    [" G6 ", "upper_primary"], // trimmed
  ];
  for (const [grade, band] of cases) {
    assert.strictEqual(gradeToBand(grade), band,
      `gradeToBand(${JSON.stringify(grade)}) should be ${band}`);
  }
  ok("gradeToBand maps ECE, G1-G12, F1-F4 correctly", true);

  for (const junk of ["", null, undefined, "G13", "F5", "Grade 5", "X1", 7]) {
    assert.strictEqual(gradeToBand(junk), null,
      `gradeToBand(${JSON.stringify(junk)}) should be null`);
  }
  ok("gradeToBand returns null for junk input", true);
}

// ── matchFormatProfile precedence ─────────────────────────────────────────
{
  const want = {
    gradeBand: "upper_primary",
    subject: "mathematics",
    assessmentType: "end_of_term",
  };

  // Exact subject hit beats the generic.
  const exact = matchFormatProfile(FORMAT_PROFILES, want);
  assert.ok(exact, "expected an exact match");
  assert.strictEqual(exact.id, "end_of_term-upper_primary-mathematics");
  ok("exact type|band|subject match wins", true);

  // Unmatched subject falls back to the band generic.
  const generic = matchFormatProfile(FORMAT_PROFILES,
    {...want, subject: "history"});
  assert.ok(generic, "expected a generic fallback match");
  assert.strictEqual(generic.id, `end_of_term-upper_primary-${GENERIC_SUBJECT}`);
  ok("unmatched subject falls back to type|band|_generic", true);

  // No band → no match (caller then uses DEFAULT_PROFILE).
  assert.strictEqual(
    matchFormatProfile(FORMAT_PROFILES, {...want, gradeBand: null}), null);
  ok("null band yields no match", true);

  // Unknown assessmentType → no match.
  assert.strictEqual(
    matchFormatProfile(FORMAT_PROFILES, {...want, assessmentType: "quiz"}),
    null);
  ok("unknown assessmentType yields no match", true);

  // Determinism: same input, same id, ten times over.
  const first = matchFormatProfile(FORMAT_PROFILES, want).id;
  for (let i = 0; i < 10; i++) {
    assert.strictEqual(matchFormatProfile(FORMAT_PROFILES, want).id, first);
  }
  ok("matching is deterministic", true);
}

// ── DEFAULT_PROFILE is itself valid and renders ───────────────────────────
{
  const res = validateFormatProfile(DEFAULT_PROFILE);
  assert.ok(res.ok, `DEFAULT_PROFILE invalid: ${res.errors.join("; ")}`);
  const block = renderFormatContextBlock(DEFAULT_PROFILE);
  assert.ok(block.includes("<assessment_format_context>"));
  assert.ok(block.length < 6000);
  ok("DEFAULT_PROFILE validates and renders under budget", true);
}

// ── validateFormatProfile rejects broken profiles ─────────────────────────
{
  const good = FORMAT_PROFILES[0];

  const noSections = {...good, paperStructure: []};
  assert.strictEqual(validateFormatProfile(noSections).ok, false);
  ok("empty paperStructure fails validation", true);

  const badShare = {
    ...good,
    paperStructure: good.paperStructure.map((s, i) =>
      (i === 0 ? {...s, marksShare: s.marksShare + 5} : s)),
  };
  assert.strictEqual(validateFormatProfile(badShare).ok, false);
  ok("marksShare not summing to 100 fails validation", true);

  const oneExemplar = {...good, exemplarQuestions: good.exemplarQuestions.slice(0, 1)};
  assert.strictEqual(validateFormatProfile(oneExemplar).ok, false);
  ok("fewer than 2 exemplars fails validation", true);

  const derived = validateFormatProfile({...good, id: ""});
  assert.strictEqual(derived.value.id, buildFormatId(good));
  ok("missing id is derived from type-band-subject", true);
}

// ── monthly_test type + format alias ──────────────────────────────────────
{
  assert.ok(ASSESSMENT_TYPES.includes("monthly_test"),
    "monthly_test is a recognised assessment type");
  assert.ok(ASSESSMENT_TYPES.includes("exercise"),
    "exercise type kept on the backend for back-compat");
  ok("ASSESSMENT_TYPES includes monthly_test (and still exercise)", true);

  // monthly_test has no dedicated seeds, so it borrows the mid_term layout.
  assert.strictEqual(FORMAT_TYPE_ALIASES.monthly_test, "mid_term",
    "monthly_test aliases to mid_term for format resolution");
  // The alias target must actually resolve to a real profile.
  const aliased = matchFormatProfile(FORMAT_PROFILES, {
    gradeBand: "upper_primary",
    subject: "mathematics",
    assessmentType: FORMAT_TYPE_ALIASES.monthly_test,
  });
  assert.ok(aliased && aliased.assessmentType === "mid_term",
    "alias target resolves to a mid_term profile");
  ok("monthly_test borrows the mid_term format profile", true);
}

// ── weekly_test type + format alias (Test Paper Studio) ────────────────────
{
  assert.ok(ASSESSMENT_TYPES.includes("weekly_test"),
    "weekly_test is a recognised assessment type");
  assert.strictEqual(ASSESSMENT_TYPE_LABELS.weekly_test, "Weekly Test",
    "weekly_test renders as 'Weekly Test'");
  ok("ASSESSMENT_TYPES includes weekly_test", true);

  // weekly_test has no dedicated seeds, so it borrows the topic_test layout
  // (a weekly test is a narrow recap, like a topic test).
  assert.strictEqual(FORMAT_TYPE_ALIASES.weekly_test, "topic_test",
    "weekly_test aliases to topic_test for format resolution");
  const aliasedWeekly = matchFormatProfile(FORMAT_PROFILES, {
    gradeBand: "upper_primary",
    subject: "mathematics",
    assessmentType: FORMAT_TYPE_ALIASES.weekly_test,
  });
  assert.ok(aliasedWeekly && aliasedWeekly.assessmentType === "topic_test",
    "weekly alias target resolves to a topic_test profile");
  ok("weekly_test borrows the topic_test format profile", true);
}

// ── examination + final_exam types (Assessment Paper Studio merge) ─────────
// Regression coverage for the "Examination silently generates as Mock
// Examination" bug: 'examination' and 'final_exam' are real, distinct,
// server-recognised types now — never aliased away in the LABEL, only in
// which format-profile STRUCTURE they borrow.
{
  for (const type of ["examination", "final_exam"]) {
    assert.ok(ASSESSMENT_TYPES.includes(type),
      `${type} is a recognised assessment type`);
  }
  ok("ASSESSMENT_TYPES includes examination and final_exam", true);

  assert.strictEqual(ASSESSMENT_TYPE_LABELS.mock_exam, "Mock Examination");
  assert.strictEqual(ASSESSMENT_TYPE_LABELS.examination, "Examination");
  assert.strictEqual(ASSESSMENT_TYPE_LABELS.final_exam, "Final Examination");
  // Distinct labels — an Examination is never rendered as "Mock Examination".
  assert.notStrictEqual(ASSESSMENT_TYPE_LABELS.examination, ASSESSMENT_TYPE_LABELS.mock_exam);
  assert.notStrictEqual(ASSESSMENT_TYPE_LABELS.final_exam, ASSESSMENT_TYPE_LABELS.mock_exam);
  ok("examination and final_exam keep their own distinct labels", true);

  // Neither has dedicated format seeds yet, so both borrow the mock_exam
  // paper STRUCTURE — but only the structure, never the label/type.
  assert.strictEqual(FORMAT_TYPE_ALIASES.examination, "mock_exam");
  assert.strictEqual(FORMAT_TYPE_ALIASES.final_exam, "mock_exam");
  for (const type of ["examination", "final_exam"]) {
    const aliased = matchFormatProfile(FORMAT_PROFILES, {
      gradeBand: "senior_secondary",
      subject: "mathematics",
      assessmentType: FORMAT_TYPE_ALIASES[type],
    });
    assert.ok(aliased && aliased.assessmentType === "mock_exam",
      `${type} alias target resolves to a mock_exam profile`);
  }
  ok("examination and final_exam borrow the mock_exam format profile", true);
}

console.log(`assessmentFormats: ${passed} checks passed`);
