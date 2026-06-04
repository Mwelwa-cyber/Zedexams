/**
 * Node test for the Exam Studio output schema validator.
 * Run: node functions/teacherTools/examPaperSchema.test.js
 */

const assert = require("node:assert");
const {validateExamPaper, SCHEMA_VERSION} = require("./examPaperSchema");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("examPaperSchema");

function goodQuestion(n = 1) {
  return {
    number: n,
    question: "Bupe sells clay pots at the market. We can call her an …",
    options: ["entrepreneur", "exporter", "importer", "investor"],
    correctAnswer: "entrepreneur",
    explanation: "She produces and sells her own goods for profit.",
    topic: "Entrepreneurship",
    difficulty: "easy",
  };
}

function goodPaper() {
  return {
    header: {
      title: "Grade 7 Creative & Technology Studies — Practice",
      grade: "G7",
      subject: "creative_and_technology_studies",
      topic: "Entrepreneurship",
      subtopic: "",
      optionCount: 4,
      instructions: "Answer ALL questions.",
    },
    questions: [goodQuestion(1), goodQuestion(2)],
  };
}

// ── Happy path ────────────────────────────────────────────────────────────
{
  const res = validateExamPaper(goodPaper());
  ok("valid paper passes", res.ok === true);
  ok("schemaVersion stamped", res.value.schemaVersion === SCHEMA_VERSION);
  ok("type normalised to multiple_choice",
    res.value.questions.every((q) => q.type === "multiple_choice"));
  ok("correctAnswer preserved", res.value.questions[0].correctAnswer === "entrepreneur");
}

// ── correctAnswer must match an option ──────────────────────────────────────
{
  const p = goodPaper();
  p.questions[0].correctAnswer = "shopkeeper"; // not in options
  const res = validateExamPaper(p);
  ok("answer not in options fails", res.ok === false);
  ok("error mentions correctAnswer",
    res.errors.some((e) => /correctAnswer/i.test(e)));
}

// ── correctAnswer matched case-insensitively is canonicalised ───────────────
{
  const p = goodPaper();
  p.questions[0].correctAnswer = "ENTREPRENEUR";
  const res = validateExamPaper(p);
  ok("case-insensitive answer passes", res.ok === true);
  ok("answer canonicalised to option text",
    res.value.questions[0].correctAnswer === "entrepreneur");
}

// ── Option count enforced against requested optionCount ─────────────────────
{
  const p = goodPaper();
  p.questions[0].options = ["entrepreneur", "exporter", "importer"]; // only 3
  const res = validateExamPaper(p, {optionCount: 4});
  ok("wrong option count fails", res.ok === false);
  ok("error mentions options",
    res.errors.some((e) => /options/i.test(e)));
}

// ── optionCount can be overridden to 3 ──────────────────────────────────────
{
  const p = goodPaper();
  p.header.optionCount = 3;
  p.questions = [{
    number: 1,
    question: "Which note comes after 'do' in the tonic sol-fa?",
    options: ["re", "mi", "fa"],
    correctAnswer: "re",
    explanation: "The order is do, re, mi, fa…",
    topic: "Music",
    difficulty: "medium",
  }];
  const res = validateExamPaper(p, {optionCount: 3});
  ok("3-option paper passes when optionCount=3", res.ok === true);
}

// ── Empty / malformed input ─────────────────────────────────────────────────
{
  const res = validateExamPaper({header: goodPaper().header, questions: []});
  ok("no questions fails", res.ok === false);
  ok("missing object fails", validateExamPaper(null).ok === false);
}

// ── Missing header.title ────────────────────────────────────────────────────
{
  const p = goodPaper();
  delete p.header.title;
  const res = validateExamPaper(p);
  ok("missing title fails", res.ok === false);
  ok("error mentions title", res.errors.some((e) => /title/i.test(e)));
}

// ── Unknown difficulty defaults to medium ───────────────────────────────────
{
  const p = goodPaper();
  p.questions[0].difficulty = "impossible";
  const res = validateExamPaper(p);
  ok("unknown difficulty defaults to medium",
    res.value.questions[0].difficulty === "medium");
}

console.log(`\nexamPaperSchema: ${passed} checks passed`);
