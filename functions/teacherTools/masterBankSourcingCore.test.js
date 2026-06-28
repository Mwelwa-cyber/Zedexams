/**
 * Tests for the pure Master Bank sourcing core: normalisation, the editor→quiz
 * mapper (incl. MCQ index→option-text), selection/balance, and the avoid-note.
 *
 * Run: node functions/teacherTools/masterBankSourcingCore.test.js
 */

const {
  normalizeGrade, normalizeSubject, editorQuestionToQuiz, selectBankQuestions,
  buildAvoidNote,
} = require("./masterBankSourcingCore");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures += 1; console.error(`  ✗ ${msg}`); }
}

console.log("normalizeGrade / normalizeSubject");
{
  assert(normalizeGrade("7") === "G7", "'7' → G7");
  assert(normalizeGrade("Grade 7") === "G7", "'Grade 7' → G7");
  assert(normalizeGrade("G7") === "G7", "'G7' stays G7");
  assert(normalizeGrade("ece") === "ECE", "'ece' → ECE");
  assert(normalizeSubject("Integrated Science") === "integrated_science", "spaces → underscores, lowercased");
  assert(normalizeSubject("Creative & Technology Studies") === "creative_and_technology_studies", "& → and");
  assert(normalizeSubject("integrated_science") === "integrated_science", "already-canonical is stable");
}

console.log("\neditorQuestionToQuiz — MCQ index → option text");
{
  const q = editorQuestionToQuiz({
    type: "mcq",
    text: "<p>What is <b>2+2</b>?</p>",
    options: ["3", "4", "5"],
    correctAnswer: 1,
    explanation: "<i>Basic sum</i>",
  });
  assert(q && q.type === "multiple_choice", "mcq → multiple_choice");
  assert(!/[<>]/.test(q.question) && q.question.includes("What is 2+2"), "HTML stripped from stem");
  assert(q.correctAnswer === "4", "index 1 resolved to option text '4'");
  assert(q.explanation === "Basic sum", "HTML stripped from explanation");
  assert(q.options.length === 3, "options carried over");
}

console.log("\neditorQuestionToQuiz — true/false + short answer");
{
  const tf = editorQuestionToQuiz({type: "tf", text: "The sky is blue.", correctAnswer: 0});
  assert(tf.type === "true_false" && tf.correctAnswer === "True" && tf.options.length === 2, "tf index 0 → True with True/False options");
  const tf2 = editorQuestionToQuiz({type: "true_false", text: "Q", correctAnswer: "false"});
  assert(tf2.correctAnswer === "False", "tf string 'false' → False");
  const sa = editorQuestionToQuiz({type: "short_answer", text: "Capital of Zambia?", correctAnswer: "Lusaka"});
  assert(sa.type === "short_answer" && sa.correctAnswer === "Lusaka" && sa.options.length === 0, "short_answer keeps text answer, no options");
}

console.log("\neditorQuestionToQuiz — drops unmappable questions");
{
  assert(editorQuestionToQuiz({type: "matching", text: "Q"}) === null, "unsupported type (matching) → null");
  assert(editorQuestionToQuiz({type: "numeric", text: "Q"}) === null, "unsupported type (numeric) → null");
  assert(editorQuestionToQuiz({type: "mcq", text: "Q", options: ["only one"], correctAnswer: 0}) === null, "MCQ with <2 options → null");
  assert(editorQuestionToQuiz({type: "mcq", text: "", options: ["a", "b"], correctAnswer: 0}) === null, "blank stem → null");
  assert(editorQuestionToQuiz({type: "mcq", text: "Q", options: ["a", "b"], correctAnswer: 9}) === null, "out-of-range correctAnswer index → null");
  assert(editorQuestionToQuiz({type: "short_answer", text: "Q", correctAnswer: ""}) === null, "short_answer with no answer → null");
}

console.log("\nselectBankQuestions — count, dedupe, difficulty balance");
{
  const mk = (id, difficulty, quality, fp) => ({fingerprint: fp || id, difficulty, quality, usage: 0, quiz: {question: id}});
  const cands = [
    mk("e1", "easy", 90), mk("e2", "easy", 80), mk("e3", "easy", 70),
    mk("m1", "medium", 95), mk("m2", "medium", 60),
    mk("h1", "hard", 85),
  ];
  const sel = selectBankQuestions(cands, {count: 3});
  assert(sel.length === 3, "respects count");
  const diffs = sel.map((c) => c.difficulty);
  assert(diffs.includes("easy") && diffs.includes("medium") && diffs.includes("hard"), "round-robin spreads across easy/medium/hard");
  // Highest-quality within the first easy/medium picks.
  assert(sel.find((c) => c.difficulty === "medium").quiz.question === "m1", "ranks by quality within a difficulty bucket");

  const dupes = [mk("a", "easy", 50, "fp1"), mk("b", "easy", 90, "fp1"), mk("c", "medium", 70, "fp2")];
  const selD = selectBankQuestions(dupes, {count: 5});
  assert(selD.length === 2, "dedupes by fingerprint");
  assert(selD.find((c) => c.fingerprint === "fp1").quality === 90, "keeps the higher-quality duplicate");

  assert(selectBankQuestions(cands, {count: 0}).length === 0, "count 0 → empty");
  assert(selectBankQuestions([], {count: 3}).length === 0, "no candidates → empty");
}

console.log("\nbuildAvoidNote");
{
  const note = buildAvoidNote([{question: "What is photosynthesis?"}, {question: "Name a noble gas"}]);
  assert(note.includes("photosynthesis") && note.includes("noble gas"), "lists existing stems");
  assert(note.toLowerCase().includes("do not repeat") || note.includes("DIFFERENT"), "instructs the model not to duplicate");
  assert(buildAvoidNote([]) === "", "empty input → empty note");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll masterBankSourcingCore tests passed.");
