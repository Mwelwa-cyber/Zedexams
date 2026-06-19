/**
 * Plain-node tests for validateWorksheet — focused on the v1.0 layout
 * additions (reading passages, grid drill sections, per-question working
 * space). Run directly:
 *
 *   node functions/teacherTools/worksheetSchema.test.js
 *
 * Throws (exit 1) on the first failed assertion, exits 0 when green — same
 * convention as the other functions/ tests wired into `test:all`.
 */

const assert = require("node:assert");
const {validateWorksheet} = require("./worksheetSchema");

function baseHeader(extra = {}) {
  return {
    title: "Grade 4 Mathematics — Fractions to Decimals",
    subject: "mathematics",
    grade: "G4",
    topic: "Decimals",
    ...extra,
  };
}

// ── A plain worksheet still validates and defaults the new fields ──────────
{
  const res = validateWorksheet({
    header: baseHeader(),
    sections: [
      {
        title: "Section A",
        questions: [
          {number: 1, type: "short_answer", prompt: "What is 1/2 as a decimal?", marks: 1, answer: "0.5"},
        ],
      },
    ],
  });
  assert.ok(res.ok, `expected ok, got: ${JSON.stringify(res.errors)}`);
  const section = res.value.sections[0];
  assert.strictEqual(section.layout, "standard", "default layout is standard");
  assert.strictEqual(section.columns, 0, "standard sections carry no column count");
  assert.strictEqual(section.passage, "", "passage defaults to empty string");
  assert.strictEqual(section.passageTitle, "", "passageTitle defaults to empty string");
  assert.strictEqual(section.questions[0].workingStyle, "", "workingStyle defaults to empty string");
}

// ── Reading-comprehension passage is preserved ────────────────────────────
{
  const res = validateWorksheet({
    header: baseHeader({subject: "english", topic: "Reading Comprehension"}),
    sections: [
      {
        title: "Reading",
        passageTitle: "A Trip to the Farm",
        passage: "One weekend, Lily and her family went to visit a farm.",
        questions: [
          {number: 1, type: "short_answer", prompt: "Where did Lily go?", marks: 2, answer: "A farm"},
        ],
      },
    ],
  });
  assert.ok(res.ok, `expected ok, got: ${JSON.stringify(res.errors)}`);
  const section = res.value.sections[0];
  assert.strictEqual(section.passageTitle, "A Trip to the Farm");
  assert.match(section.passage, /Lily and her family/);
  assert.strictEqual(section.layout, "standard", "a passage section stays standard layout");
}

// ── Grid layout clamps columns to 2-4 and defaults to 3 ───────────────────
{
  const grid = (columns) => validateWorksheet({
    header: baseHeader(),
    sections: [
      {
        title: "Convert these fractions",
        layout: "grid",
        columns,
        questions: [
          {number: 1, type: "calculation", prompt: "7/10 =", marks: 1, answer: "0.7"},
          {number: 2, type: "calculation", prompt: "3/5 =", marks: 1, answer: "0.6"},
        ],
      },
    ],
  });

  assert.strictEqual(grid(4).value.sections[0].columns, 4, "4 columns kept");
  assert.strictEqual(grid(9).value.sections[0].columns, 4, "columns clamped down to 4");
  assert.strictEqual(grid(1).value.sections[0].columns, 2, "columns clamped up to 2");
  assert.strictEqual(grid(undefined).value.sections[0].columns, 3, "grid defaults to 3 columns");
  assert.strictEqual(grid(3).value.sections[0].layout, "grid", "layout preserved");
}

// ── workingStyle accepts the whitelist and rejects junk ───────────────────
{
  const res = validateWorksheet({
    header: baseHeader(),
    sections: [
      {
        title: "Long Division",
        questions: [
          {number: 1, type: "calculation", prompt: "421 ÷ 6", marks: 2, answer: "70 R1", workingStyle: "columns"},
          {number: 2, type: "calculation", prompt: "562 ÷ 9", marks: 2, answer: "62 R4", workingStyle: "nonsense"},
        ],
      },
    ],
  });
  assert.ok(res.ok, `expected ok, got: ${JSON.stringify(res.errors)}`);
  assert.strictEqual(res.value.sections[0].questions[0].workingStyle, "columns", "valid workingStyle kept");
  assert.strictEqual(res.value.sections[0].questions[1].workingStyle, "", "invalid workingStyle reset to ''");
}

// ── Unknown layout falls back to standard ─────────────────────────────────
{
  const res = validateWorksheet({
    header: baseHeader(),
    sections: [
      {
        title: "Section",
        layout: "fancy",
        questions: [{number: 1, type: "short_answer", prompt: "Q", marks: 1, answer: "A"}],
      },
    ],
  });
  assert.strictEqual(res.value.sections[0].layout, "standard", "unknown layout coerced to standard");
}

console.log("worksheetSchema.test.js — all assertions passed");
