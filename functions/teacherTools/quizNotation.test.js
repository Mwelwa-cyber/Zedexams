/**
 * The quiz generators keep the notation contract (Phase 5 stage 2).
 *
 * Two quiz generators, two different destinations, two different ladders —
 * and the difference is the point under test:
 *
 *   - The quiz EDITOR path (generateQuizQuestions → CreateQuizV2) renders
 *     markup as real nodes, so it gets repair-into-markup THEN the floor.
 *   - The quiz DOCUMENT path (generateQuiz) renders plain strings in the
 *     library, so it gets the FLOOR ONLY: repairing "3/5" into markup there
 *     would put raw markup on a page that cannot draw it.
 *
 * Run: node functions/teacherTools/quizNotation.test.js
 */

const assert = require("node:assert/strict");
const {
  enforceNotation, applyPlainTextFloor, flattenMarkupToPlainText,
  QUIZ_EDITOR_FIELDS, QUIZ_DOC_FIELDS, WORKSHEET_FIELDS, HOMEWORK_FIELDS,
} = require("./notationEnforcement");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

(async () => {
  console.log("\nquiz editor path — repair into markup, then floor");

  await test("a bare power and sqrt in editor fields are repaired to markup", async () => {
    const questions = [{
      text: "Simplify x^2 + sqrt(49) fully.",
      options: ["x^2", "7", "sqrt(49)", "14"],
      explanation: "Because sqrt(49) = 7.",
      correctAnswer: 1,
    }];
    const report = await enforceNotation(questions, {
      subject: "mathematics", fields: QUIZ_EDITOR_FIELDS,
    });
    assert.equal(report.applied, true);
    assert.ok(report.repaired >= 3, `expected repairs, got ${report.repaired}`);
    assert.match(questions[0].text, /\$x\^\{2\}\$/);
    assert.match(questions[0].text, /\$\\sqrt\{49\}\$/);
    assert.match(questions[0].options[0], /\$x\^\{2\}\$/);
    assert.match(questions[0].explanation, /\$\\sqrt\{49\}\$/);
  });

  await test("the machine-compared answer key is never touched", async () => {
    // QUIZ_EDITOR_FIELDS deliberately omits answer/correctAnswer: a short
    // answer is compared against what a learner TYPES, so markup in it would
    // mark every learner wrong.
    const paths = QUIZ_EDITOR_FIELDS.map((f) => f.path);
    assert.ok(!paths.includes("answer") && !paths.includes("correctAnswer"),
        "the editor field list must not include the answer key");
    const questions = [{
      text: "What is $x^2$ when x = 3?",
      options: [],
      answer: "sqrt(81)",
      correctAnswer: "9",
      explanation: "3 times 3.",
    }];
    await enforceNotation(questions, {subject: "mathematics", fields: QUIZ_EDITOR_FIELDS});
    await applyPlainTextFloor(questions, {subject: "mathematics", fields: QUIZ_EDITOR_FIELDS});
    assert.equal(questions[0].answer, "sqrt(81)");
    assert.equal(questions[0].correctAnswer, "9");
  });

  await test("fill-in-the-blank statements are covered; their answers are not", async () => {
    const questions = [{
      text: "Complete the statements.",
      statements: [
        {text: "Half of 10 is x^2 minus ____.", answer: "5"},
      ],
      wordBank: ["5", "x^2"],
    }];
    await enforceNotation(questions, {subject: "mathematics", fields: QUIZ_EDITOR_FIELDS});
    assert.match(questions[0].statements[0].text, /\$x\^\{2\}\$/);
    assert.equal(questions[0].statements[0].answer, "5", "a typed answer stays plain");
    // The word bank holds the answers the learner TYPES against, so like the
    // answer key it stays exactly as generated.
    assert.equal(questions[0].wordBank[1], "x^2");
  });

  await test("a non-maths subject is left entirely alone", async () => {
    const questions = [{text: "Define erosion in 3/4 sentences.", options: []}];
    const report = await enforceNotation(questions, {
      subject: "english", fields: QUIZ_EDITOR_FIELDS,
    });
    assert.equal(report.applied, false);
    assert.equal(questions[0].text, "Define erosion in 3/4 sentences.");
  });

  console.log("\nquiz document path — the floor only");

  await test("markup the model emitted is flattened to readable plain text", async () => {
    const quiz = {questions: [{
      question: "Work out $\\sqrt{49}$ + \\frac{1}{2}.",
      options: ["$x^2$", "7"],
      // The doc schema's MCQ key IS the option text, so it must flatten in
      // step with the option or the saved quiz has no matching key.
      correctAnswer: "$x^2$",
      explanation: "Use \\frac{1}{2} of the total.",
    }]};
    const {flattened} = await flattenMarkupToPlainText(quiz, {
      subject: "mathematics", fields: QUIZ_DOC_FIELDS,
    });
    assert.ok(flattened >= 2, `expected flattening, got ${flattened}`);
    assert.equal(quiz.questions[0].correctAnswer, quiz.questions[0].options[0],
        "the flattened key still matches its flattened option");
    for (const value of [
      quiz.questions[0].question,
      quiz.questions[0].options[0],
      quiz.questions[0].explanation,
    ]) {
      assert.ok(!value.includes("\\frac") && !value.includes("$"),
          `markup survived to a plain-string page: ${value}`);
    }
  });

  console.log("\nthe field subsets say what they mean");

  await test("worksheet and homework lists carry the answer key — it is printed, not compared", async () => {
    // A worksheet is marked by a teacher READING the printed key, so its
    // answer is display and belongs on the contract; a quiz's is comparison.
    assert.ok(WORKSHEET_FIELDS.some((f) => f.path === "answer"));
    assert.ok(HOMEWORK_FIELDS.some((f) => f.path === "answer"));
    assert.ok(WORKSHEET_FIELDS.some((f) => f.path === "workingNotes"));
    assert.ok(!QUIZ_DOC_FIELDS.some((f) => f.path === "answer"));
    assert.ok(!QUIZ_EDITOR_FIELDS.some((f) => f.path === "wordBank[]"),
        "the word bank is typed against, so it stays off the editor list");
  });

  console.log(`\n${passed} quiz notation checks passed\n`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
