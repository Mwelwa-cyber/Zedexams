/**
 * Server-side notation enforcement (Phase 2 §3).
 *
 * The fixtures are deliberately UGLY — realistic model output, not idealised
 * output. A generation that already complies proves nothing about a stage
 * whose entire job is the generation that does not.
 *
 * Run: node functions/teacherTools/notationEnforcement.test.js
 */

const assert = require("node:assert/strict");
const {
  MATHS_SUBJECT_KEYS, SCIENCE_SUBJECT_KEYS, isMathsSubjectKey, isScienceSubjectKey,
  enforceNotation, buildCorrectiveInstruction, applyPlainTextFloor,
} = require("./notationEnforcement");

let passed = 0;
// Checks are queued rather than run inline because several are async (the
// contract is an ESM dynamic import). Headings are queued too, or they would
// all print before the first test ran and the output would describe a
// different order from the one that executed.
const pending = [];
function check(name, fn) {
  pending.push(async () => {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}
function section(title) {
  pending.push(async () => console.log(`\n${title}`));
}

/** A generation the model got WRONG in every way §3 names. */
function nonCompliantPaper() {
  return {
    header: {title: "Mathematics Test", subject: "mathematics", grade: "7"},
    sections: [{
      title: "Section A",
      passage: {title: "At the market", text: "Mary sold 3/5 of her tomatoes."},
      questions: [
        {
          type: "short_answer",
          prompt: "Write the fraction 3/5 in its lowest terms.",
          answer: "3/5",
          markingGuide: "Award 1 mark.",
        },
        {
          type: "multiple_choice",
          prompt: "Which equals x^2 when x = 3?",
          options: ["6", "9", "x^2", "sqrt(81)"],
          answer: "9",
        },
        {
          type: "structured",
          prompt: "Work out the following.",
          parts: [
            {text: "Convert 2 3/7 to an improper fraction.", answer: "17/7", marks: 2},
            {text: "Find sqrt(49).", answer: "7", marks: 1},
          ],
        },
        {
          type: "short_answer",
          prompt: "Work out:\n  234\n+  13\n-----",
          answer: "247",
        },
        {
          type: "short_answer",
          prompt: "Complete the sum [[vmath op=+ answer=37]] and show working.",
          answer: "37",
        },
      ],
    }],
  };
}

section("which papers are enforced");

check("the three canonical maths keys turn enforcement on", () => {
  assert.deepEqual([...MATHS_SUBJECT_KEYS].sort(),
      ["mathematics", "mathematics_ii", "numeracy"]);
  for (const key of MATHS_SUBJECT_KEYS) {
    assert.equal(isMathsSubjectKey(key), true, key);
  }
});

check("the server list matches Phase 1's studio list exactly", async () => {
  // A paper the studio gives mathematics TOOLS to is a paper the server owes
  // mathematics NOTATION. If these drift, a Grade 2 teacher gets the fraction
  // button and unenforced "3/5" from the generator.
  const studio = await import("../../src/shared/utils/mathsSubjects.js");
  assert.deepEqual(
      [...MATHS_SUBJECT_KEYS].sort(),
      [...studio.MATHS_SUBJECT_KEYS].sort(),
      "server and studio disagree about which subjects are mathematics",
  );
});

check("a non-mathematics paper is not touched at all", async () => {
  const paper = nonCompliantPaper();
  const before = JSON.stringify(paper);
  const report = await enforceNotation(paper, {subject: "english"});
  assert.equal(report.applied, false);
  assert.equal(report.repaired, 0);
  assert.equal(JSON.stringify(paper), before, "a non-maths paper was rewritten");
});

section("science subjects (Phase 3)");

check("the server science list matches the shared contract exactly", async () => {
  const core = await import("../shared/assessment/mathsNotationCore.js");
  assert.deepEqual(
      [...SCIENCE_SUBJECT_KEYS].sort(),
      [...core.SCIENCE_SUBJECT_KEYS].sort(),
      "the server and the contract disagree about which subjects are science",
  );
});

check("a science paper's formulae, arrows, units and degrees are all repaired", async () => {
  const paper = {
    header: {subject: "integrated_science"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "Water is H2O. Complete: carbon dioxide + water -> glucose + oxygen.",
      answer: "CO2",
      markingGuide: "Accept 9.8 m/s2 measured at 30 deg C.",
      parts: [{text: "Name the gas O2 in 2H2 + O2 -> 2H2O.", answer: "oxygen"}],
    }]}],
  };
  const report = await enforceNotation(paper, {subject: "integrated_science"});
  assert.equal(report.applied, true);
  const q = paper.sections[0].questions[0];
  assert.match(q.prompt, /H<sub>2<\/sub>O/);
  assert.match(q.prompt, /→/);
  assert.match(q.answer, /CO<sub>2<\/sub>/);
  assert.match(q.markingGuide, /m\/s<sup>2<\/sup>/);
  assert.match(q.markingGuide, /30 °C/);
  assert.match(q.parts[0].text, /O<sub>2<\/sub>/);
});

check("the integrated learning area gets BOTH contracts on one paper", async () => {
  // A Grade 2 "Mathematics and Science" paper can carry a column sum and a
  // water molecule on the same page, so `numeracy` owes both.
  assert.equal(isMathsSubjectKey("numeracy"), true);
  assert.equal(isScienceSubjectKey("numeracy"), true);
  const paper = {
    header: {subject: "numeracy"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "Write the fraction 3/5 in its lowest terms. Water is H2O.",
      answer: "3/5",
    }]}],
  };
  await enforceNotation(paper, {subject: "numeracy"});
  const prompt = paper.sections[0].questions[0].prompt;
  assert.match(prompt, /\\frac\{3\}\{5\}/, "the maths contract did not run");
  assert.match(prompt, /H<sub>2<\/sub>O/, "the science contract did not run");
});

check("a science paper is not subjected to the MATHS repairs it does not owe", async () => {
  // integrated_science is not in the maths list, so a bare a/b there is left
  // alone even in a fractional-sounding sentence — that contract is not its.
  const paper = {
    header: {subject: "biology"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "The fraction 3/5 of the sample was water, H2O.",
      answer: "water",
    }]}],
  };
  await enforceNotation(paper, {subject: "biology"});
  const prompt = paper.sections[0].questions[0].prompt;
  assert.match(prompt, /3\/5/, "a maths repair ran on a science-only paper");
  assert.match(prompt, /H<sub>2<\/sub>O/);
});

check("a language paper is still untouched by either contract", async () => {
  const paper = {
    header: {subject: "english"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "Water is H2O and 3/5 of the class agreed.",
      answer: "yes",
    }]}],
  };
  const before = JSON.stringify(paper);
  const report = await enforceNotation(paper, {subject: "english"});
  assert.equal(report.applied, false);
  assert.equal(JSON.stringify(paper), before);
});

section("detect and repair");

check("every mechanically-fixable field is repaired across the whole paper", async () => {
  const paper = nonCompliantPaper();
  const report = await enforceNotation(paper, {subject: "mathematics"});
  assert.equal(report.applied, true);
  assert.ok(report.repaired >= 5, `expected several repairs, got ${report.repaired}`);

  const [q1, q2, q3] = paper.sections[0].questions;
  // "the fraction 3/5" — the text proves the context, so it is repaired.
  assert.match(q1.prompt, /\\frac\{3\}\{5\}/);
  // x^2 and sqrt(81) in options.
  assert.match(q2.prompt, /\$x\^\{2\}\$/);
  assert.match(q2.options[2], /\$x\^\{2\}\$/);
  assert.match(q2.options[3], /\\sqrt\{81\}/);
  // The sub-part leak, on the server side this time.
  assert.match(q3.parts[0].text, /2\\frac\{3\}\{7\}/);
  assert.match(q3.parts[1].text, /\\sqrt\{49\}/);
});

check("a passage is repaired once, not once per question", async () => {
  const paper = nonCompliantPaper();
  await enforceNotation(paper, {subject: "mathematics"});
  // "sold 3/5 of her tomatoes" has no fractional keyword, so it stays — the
  // point here is that the passage is VISITED and not corrupted by five passes.
  assert.equal(paper.sections[0].passage.text.match(/3\/5/g).length, 1);
});

check("an ambiguous bare fraction is NOT repaired, on the server either", async () => {
  const paper = {
    header: {subject: "mathematics"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "The ratio of boys to girls is 3/5. How many boys are there?",
      answer: "12",
    }]}],
  };
  await enforceNotation(paper, {subject: "mathematics"});
  assert.match(paper.sections[0].questions[0].prompt, /3\/5/);
  assert.ok(!/\\frac/.test(paper.sections[0].questions[0].prompt));
});

section("the retry decision");

check("a retry is asked for ONLY when something repair refused remains", async () => {
  const paper = nonCompliantPaper();
  const report = await enforceNotation(paper, {subject: "mathematics"});
  // The ASCII column sum and the malformed token cannot be repaired
  // mechanically, so they are what justifies spending a call.
  assert.equal(report.needsRetry, true);
  const codes = report.violations
      .flatMap((v) => v.fields)
      .flatMap((f) => f.violations)
      .map((x) => x.code);
  assert.ok(codes.includes("ASCII_COLUMN_SUM") || codes.includes("VMATH_MALFORMED"));
});

check("a paper repair fully fixed asks for NO retry — no call is wasted", async () => {
  const paper = {
    header: {subject: "mathematics"},
    sections: [{questions: [
      {type: "short_answer", prompt: "Simplify x^2 + 1.", answer: "9"},
      {type: "short_answer", prompt: "Find sqrt(49).", answer: "7"},
    ]}],
  };
  const report = await enforceNotation(paper, {subject: "mathematics"});
  assert.ok(report.repaired >= 2);
  assert.equal(report.needsRetry, false, "a fully-repaired paper must not spend a model call");
});

check("an already-compliant paper reports zero repairs and no retry", async () => {
  const paper = {
    header: {subject: "mathematics"},
    sections: [{questions: [{
      type: "multiple_choice",
      prompt: "Calculate \\frac{3}{5} + \\frac{1}{4}.",
      options: ["\\frac{17}{20}", "\\frac{4}{9}", "\\frac{1}{2}", "\\frac{2}{3}"],
      answer: "\\frac{17}{20}",
      markingGuide: "Common denominator 20.",
    }]}],
  };
  const report = await enforceNotation(paper, {subject: "mathematics"});
  assert.equal(report.repaired, 0);
  assert.equal(report.needsRetry, false);
  assert.deepEqual(report.violations, []);
});

check("the corrective instruction quotes the model's own offending text", () => {
  // Restating the rules is the least likely thing to change the outcome — the
  // model has already seen them and produced this.
  const instruction = buildCorrectiveInstruction([{
    sectionIndex: 0, questionIndex: 3, prompt: "Work out:",
    fields: [{path: "prompt", violations: [{code: "ASCII_COLUMN_SUM", sample: "a column sum drawn in text", repairable: false}]}],
  }]);
  assert.match(instruction, /Question 4/);
  assert.match(instruction, /a column sum drawn in text/);
  assert.match(instruction, /notation fix, not a rewrite/);
  assert.match(instruction, /\[\[vmath/);
});

section("the plain-text floor");

check("whatever survives repair and retry is flattened, never left as markup", async () => {
  const paper = nonCompliantPaper();
  await enforceNotation(paper, {subject: "mathematics"});
  const {flattened} = await applyPlainTextFloor(paper, {subject: "mathematics"});
  assert.ok(flattened >= 1);

  // The §3 guarantee, checked over every string in the finished paper.
  const walk = (node, out = []) => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach((n) => walk(n, out));
    else if (node && typeof node === "object") Object.values(node).forEach((n) => walk(n, out));
    return out;
  };
  for (const value of walk(paper)) {
    assert.ok(!value.includes("[object Object]"), value);
    assert.ok(!/\[\[\s*vmath(?![^\]]*\blines\s*=)/.test(value),
        `a malformed token survived the floor: ${value}`);
  }
});

check("the floor leaves COMPLIANT markup alone — it is not a flattener", async () => {
  // It runs after enforcement on every maths paper, so if it flattened
  // indiscriminately it would undo the whole phase.
  const paper = {
    header: {subject: "mathematics"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "Calculate \\frac{3}{5} + \\frac{1}{4}.",
      answer: "\\frac{17}{20}",
    }]}],
  };
  const {flattened} = await applyPlainTextFloor(paper, {subject: "mathematics"});
  assert.equal(flattened, 0);
  assert.match(paper.sections[0].questions[0].prompt, /\\frac\{3\}\{5\}/);
});

check("a broken token degrades to the sum it stood for", async () => {
  const paper = {
    header: {subject: "mathematics"},
    sections: [{questions: [{
      type: "short_answer",
      prompt: "Work out [[vmath op=+ answer=37]] now.",
      answer: "37",
    }]}],
  };
  await applyPlainTextFloor(paper, {subject: "mathematics"});
  const prompt = paper.sections[0].questions[0].prompt;
  assert.ok(!prompt.includes("[["), `raw token survived: ${prompt}`);
});

section("robustness");

check("malformed input never throws", async () => {
  for (const input of [null, undefined, {}, {sections: null}, {sections: [null]},
    {sections: [{questions: [null, "junk", 42]}]}]) {
    const report = await enforceNotation(input, {subject: "mathematics"});
    assert.equal(typeof report.repaired, "number");
    await applyPlainTextFloor(input, {subject: "mathematics"});
  }
});

(async () => {
  for (const t of pending) await t();
  console.log(`\n${passed} notation-enforcement checks passed\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
