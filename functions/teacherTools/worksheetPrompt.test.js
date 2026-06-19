/**
 * Plain-node tests for buildUserPrompt — focused on the teacher-selectable
 * worksheet "style" directive. Run directly:
 *
 *   node functions/teacherTools/worksheetPrompt.test.js
 *
 * Throws (exit 1) on the first failed assertion, exits 0 when green.
 */

const assert = require("node:assert");
const {buildUserPrompt} = require("./worksheetPrompt");

const base = {
  grade: "G4",
  subject: "mathematics",
  topic: "Decimals",
};

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

// ── unknown style behaves like auto (no directive) ────────────────────────
{
  const prompt = buildUserPrompt({...base, style: "nonsense"});
  assert.ok(
    !prompt.includes("required worksheet format"),
    "unknown style must not inject a forced format directive",
  );
}

console.log("worksheetPrompt.test.js — all assertions passed");
