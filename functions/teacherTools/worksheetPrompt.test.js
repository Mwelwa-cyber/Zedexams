/**
 * Plain-node tests for buildUserPrompt — focused on the teacher-selectable
 * worksheet "style" directive. Run directly:
 *
 *   node functions/teacherTools/worksheetPrompt.test.js
 *
 * Throws (exit 1) on the first failed assertion, exits 0 when green.
 */

const assert = require("node:assert");
const {
  buildUserPrompt,
  pickSystemPrompt,
  PROMPT_VERSION,
  SYSTEM_PROMPT_CBC,
  SYSTEM_PROMPT_PREVIOUS,
} = require("./worksheetPrompt");

const base = {
  grade: "G4",
  subject: "mathematics",
  topic: "Decimals",
};

// ── prompt version bumped to v2 ───────────────────────────────────────────
{
  assert.strictEqual(
    PROMPT_VERSION,
    "worksheet.v3",
    "PROMPT_VERSION should be worksheet.v3",
  );
}

// ── CBC vs Previous curriculum system-prompt selection ────────────────────
{
  // Renamed CBC constant is the exported default.
  assert.ok(
    /Competence-Based Curriculum \(CBC\)/.test(SYSTEM_PROMPT_CBC),
    "SYSTEM_PROMPT_CBC should keep the CBC framing",
  );
  assert.ok(
    /Outcomes-Based Education/.test(SYSTEM_PROMPT_PREVIOUS),
    "SYSTEM_PROMPT_PREVIOUS should carry the Previous-curriculum framing",
  );

  // pickSystemPrompt routes on curriculum/framework.
  const previousPrompt = pickSystemPrompt({...base, curriculum: "previous"});
  assert.ok(
    previousPrompt.includes("pupils"),
    "Previous system prompt must use 'pupils'",
  );
  assert.strictEqual(
    previousPrompt,
    SYSTEM_PROMPT_PREVIOUS,
    "curriculum:'previous' should select the Previous system prompt",
  );
  assert.strictEqual(
    pickSystemPrompt({...base, framework: "2013"}),
    SYSTEM_PROMPT_PREVIOUS,
    "framework:'2013' should select the Previous system prompt",
  );
  assert.strictEqual(
    pickSystemPrompt({...base}),
    SYSTEM_PROMPT_CBC,
    "default (no curriculum) should select the CBC system prompt",
  );

  // The user-prompt terminology branch: CBC → 'learners', Previous → 'pupils'.
  assert.ok(
    buildUserPrompt({...base}).includes('refer to the class as "learners"'),
    "CBC user prompt should refer to 'learners'",
  );
  assert.ok(
    buildUserPrompt({...base, curriculum: "previous"})
      .includes('refer to the class as "pupils"'),
    "Previous user prompt should refer to 'pupils'",
  );
  assert.ok(
    buildUserPrompt({...base, curriculum: "previous"})
      .includes("Previous-Curriculum (Outcomes-Based)"),
    "Previous user prompt heading should name the Previous curriculum",
  );
}

// ── auto / omitted: no forced format directive ────────────────────────────
{
  const prompt = buildUserPrompt({...base});
  assert.ok(
    !prompt.includes("required worksheet format"),
    "auto style must not inject a forced format directive",
  );

  const promptAuto = buildUserPrompt({...base, style: "auto"});
  assert.ok(
    !promptAuto.includes("required worksheet format"),
    "explicit auto style must not inject a forced format directive",
  );
}

// ── each explicit style injects its directive ─────────────────────────────
{
  const cases = {
    grid: /Practice grid.*layout "grid"/s,
    comprehension: /Reading comprehension.*"passage"/s,
    working: /Show working.*"workingStyle":"columns"/s,
    standard: /Question & answer.*layout "standard"/s,
    matching: /Matching.*answer bank/s,
    word_problems: /Word problems.*word problem/s,
    true_false: /True or False.*"true_false"/s,
  };
  for (const [style, re] of Object.entries(cases)) {
    const prompt = buildUserPrompt({...base, style});
    assert.ok(
      prompt.includes("required worksheet format"),
      `style "${style}" should inject a forced format directive`,
    );
    assert.match(prompt, re, `style "${style}" directive text mismatch`);
  }
}

// ── grid column override is injected only for 2-4 ─────────────────────────
{
  assert.match(
    buildUserPrompt({...base, style: "grid", gridColumns: 4}),
    /set "columns" to exactly 4/,
    "gridColumns:4 should pin the column count",
  );
  assert.ok(
    !buildUserPrompt({...base, style: "grid", gridColumns: 0}).includes("set \"columns\" to exactly"),
    "gridColumns:0 (auto) should not pin a column count",
  );
  assert.ok(
    !buildUserPrompt({...base, style: "grid", gridColumns: 9}).includes("set \"columns\" to exactly"),
    "out-of-range gridColumns should not pin a column count",
  );
}

// ── passage length directive maps short/medium/long ───────────────────────
{
  assert.match(
    buildUserPrompt({...base, style: "comprehension", passageLength: "short"}),
    /short — about 3-4 sentences/,
    "passageLength:short directive missing",
  );
  assert.match(
    buildUserPrompt({...base, style: "comprehension", passageLength: "long"}),
    /longer — about 10-14 sentences/,
    "passageLength:long directive missing",
  );
  assert.ok(
    !buildUserPrompt({...base, style: "comprehension"}).includes("reading passage should be"),
    "no passageLength should not inject a length directive",
  );
}

// ── unknown style behaves like auto (no directive) ────────────────────────
{
  const prompt = buildUserPrompt({...base, style: "nonsense"});
  assert.ok(
    !prompt.includes("required worksheet format"),
    "unknown style must not inject a forced format directive",
  );
}

console.log("worksheetPrompt.test.js — all assertions passed");
