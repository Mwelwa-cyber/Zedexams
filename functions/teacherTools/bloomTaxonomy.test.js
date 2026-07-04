/**
 * Node test for bloomTaxonomy — the pure grade-aware cognitive-demand +
 * language-ladder helper.
 * Run: node functions/teacherTools/bloomTaxonomy.test.js
 */

const assert = require("node:assert");
const {
  BLOOM_LEVELS,
  BLOOM_RANK,
  normalizeBloom,
  bloomProfileForGrade,
  bloomWithinCeiling,
  gradeLanguageLadder,
} = require("./bloomTaxonomy");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("bloomTaxonomy");

// ── canonical levels ──────────────────────────────────────────────────────
{
  assert.deepStrictEqual(BLOOM_LEVELS, [
    "remember", "understand", "apply", "analyse", "evaluate", "create",
  ]);
  assert.strictEqual(BLOOM_RANK.remember, 0);
  assert.strictEqual(BLOOM_RANK.create, 5);
  ok("BLOOM_LEVELS are ordered lowest → highest", true);
}

// ── normalizeBloom folds spellings + noun forms ───────────────────────────
{
  const cases = [
    ["Remember", "remember"], ["knowledge", "remember"], ["recall", "remember"],
    ["Comprehension", "understand"], ["understanding", "understand"],
    ["Application", "apply"], ["applying", "apply"],
    ["analyze", "analyse"], ["Analysis", "analyse"], ["ANALYSE", "analyse"],
    ["evaluation", "evaluate"],
    ["synthesis", "create"], ["synthesize", "create"], ["creating", "create"],
    ["  apply  ", "apply"],
  ];
  for (const [input, want] of cases) {
    assert.strictEqual(normalizeBloom(input), want,
      `normalizeBloom(${JSON.stringify(input)}) → ${want}`);
  }
  for (const junk of ["", null, undefined, "wisdom", 7, {}]) {
    assert.strictEqual(normalizeBloom(junk), null,
      `normalizeBloom(${JSON.stringify(junk)}) → null`);
  }
  ok("normalizeBloom folds spellings/noun forms and rejects junk", true);
}

// ── bloomProfileForGrade: ceiling rises with the band ─────────────────────
{
  assert.strictEqual(bloomProfileForGrade("G1").band, "lower_primary");
  assert.strictEqual(bloomProfileForGrade("G1").ceiling, "apply");
  assert.strictEqual(bloomProfileForGrade("G7").band, "upper_primary");
  assert.strictEqual(bloomProfileForGrade("G7").ceiling, "analyse");
  assert.strictEqual(bloomProfileForGrade("G9").ceiling, "evaluate");
  assert.strictEqual(bloomProfileForGrade("G12").ceiling, "create");
  // Junk grade falls back to the upper-primary default rather than throwing.
  assert.strictEqual(bloomProfileForGrade("nonsense").band, "upper_primary");
  assert.ok(Array.isArray(bloomProfileForGrade("G4").verbs) &&
    bloomProfileForGrade("G4").verbs.length > 0);
  ok("bloomProfileForGrade raises the ceiling with the grade band", true);
}

// ── bloomWithinCeiling ────────────────────────────────────────────────────
{
  assert.strictEqual(bloomWithinCeiling("remember", "G1"), true);
  assert.strictEqual(bloomWithinCeiling("apply", "G1"), true);
  // A lower-primary paper should not reach "evaluate".
  assert.strictEqual(bloomWithinCeiling("evaluate", "G1"), false);
  assert.strictEqual(bloomWithinCeiling("create", "G2"), false);
  // Senior secondary tops out at create.
  assert.strictEqual(bloomWithinCeiling("create", "G12"), true);
  // Untagged/unknown levels never count against a paper.
  assert.strictEqual(bloomWithinCeiling(null, "G1"), true);
  assert.strictEqual(bloomWithinCeiling("wisdom", "G1"), true);
  ok("bloomWithinCeiling gates levels by grade and is lenient on junk", true);
}

// ── gradeLanguageLadder ───────────────────────────────────────────────────
{
  const g1 = gradeLanguageLadder("G1");
  assert.strictEqual(g1.band, "lower_primary");
  assert.ok(/short/i.test(g1.rules));
  assert.ok(g1.example.length > 0);
  const g9 = gradeLanguageLadder("G9");
  assert.strictEqual(g9.band, "junior_secondary");
  assert.ok(/analyse|reasoning/i.test(g9.rules));
  // The four bands give four distinct rule strings.
  const rules = new Set([
    gradeLanguageLadder("G1").rules,
    gradeLanguageLadder("G5").rules,
    gradeLanguageLadder("G8").rules,
    gradeLanguageLadder("G11").rules,
  ]);
  assert.strictEqual(rules.size, 4);
  ok("gradeLanguageLadder gives distinct, grade-appropriate rules", true);
}

console.log(`\nbloomTaxonomy: ${passed} checks passed`);
