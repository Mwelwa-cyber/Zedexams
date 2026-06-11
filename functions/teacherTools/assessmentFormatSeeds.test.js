/**
 * Node test for the built-in Zambian assessment format seed profiles.
 * Run: node functions/teacherTools/assessmentFormatSeeds.test.js
 */

const assert = require("node:assert");
const {FORMAT_PROFILES} = require("./assessmentFormatSeeds");
const {
  ASSESSMENT_TYPES,
  GRADE_BANDS,
  GENERIC_SUBJECT,
  buildFormatId,
  validateFormatProfile,
  renderFormatContextBlock,
} = require("./assessmentFormats");
const {ALLOWED_SUBJECTS} = require("./assessmentAllowlists");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("assessmentFormatSeeds");

// ── Every seed validates ──────────────────────────────────────────────────
{
  for (const p of FORMAT_PROFILES) {
    const res = validateFormatProfile(p);
    assert.ok(res.ok,
      `seed ${p.id} failed validation: ${res.errors.join("; ")}`);
  }
  ok(`all ${FORMAT_PROFILES.length} seeds pass validateFormatProfile`, true);
}

// ── Ids are unique and derived from type-band-subject ─────────────────────
{
  const ids = new Set();
  for (const p of FORMAT_PROFILES) {
    assert.ok(!ids.has(p.id), `duplicate seed id: ${p.id}`);
    ids.add(p.id);
    const expected = buildFormatId(p);
    assert.strictEqual(p.id, expected,
      `seed id ${p.id} should be ${expected}`);
  }
  ok("seed ids unique and equal to type-band-subject", true);
}

// ── Subjects key on the server's canonical list ───────────────────────────
{
  for (const p of FORMAT_PROFILES) {
    if (p.subject === GENERIC_SUBJECT) continue;
    assert.ok(ALLOWED_SUBJECTS.has(p.subject),
      `seed ${p.id} uses subject "${p.subject}" not in ALLOWED_SUBJECTS`);
  }
  ok("non-generic seed subjects are canonical ALLOWED_SUBJECTS keys", true);
}

// ── Enum fields + marks shares + exemplar counts ───────────────────────────
{
  for (const p of FORMAT_PROFILES) {
    assert.ok(ASSESSMENT_TYPES.includes(p.assessmentType),
      `seed ${p.id} bad assessmentType`);
    assert.ok(GRADE_BANDS.includes(p.gradeBand),
      `seed ${p.id} bad gradeBand`);
    const sum = p.paperStructure.reduce((s, x) => s + x.marksShare, 0);
    assert.strictEqual(sum, 100,
      `seed ${p.id} marksShare sums to ${sum}, expected 100`);
    assert.ok(
      p.exemplarQuestions.length >= 2 && p.exemplarQuestions.length <= 4,
      `seed ${p.id} has ${p.exemplarQuestions.length} exemplars, want 2-4`);
  }
  ok("types, bands, marks shares (=100) and exemplar counts (2-4) hold", true);
}

// ── Generic backbone coverage ──────────────────────────────────────────────
{
  const ids = new Set(FORMAT_PROFILES.map((p) => p.id));
  for (const band of GRADE_BANDS) {
    for (const type of ["topic_test", "end_of_term"]) {
      const id = buildFormatId(
        {assessmentType: type, gradeBand: band, subject: GENERIC_SUBJECT});
      assert.ok(ids.has(id), `missing generic backbone profile: ${id}`);
    }
  }
  ok("generic backbone exists for all bands × topic_test/end_of_term", true);
}

// ── Rendered blocks stay within the prompt-size budget ─────────────────────
{
  for (const p of FORMAT_PROFILES) {
    const block = renderFormatContextBlock(p);
    assert.ok(block.startsWith("<assessment_format_context>"),
      `seed ${p.id} block missing opening tag`);
    assert.ok(block.endsWith("</assessment_format_context>"),
      `seed ${p.id} block missing closing tag`);
    assert.ok(block.length < 6000,
      `seed ${p.id} renders to ${block.length} chars, budget is 6000`);
  }
  ok("every rendered seed block is tagged and under 6,000 chars", true);
}

console.log(`assessmentFormatSeeds: ${passed} checks passed`);
