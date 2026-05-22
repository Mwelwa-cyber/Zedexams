/**
 * Practice Quiz Generator (stub).
 *
 * Writes a stub artifact to learnerAiGenerations end-to-end. To wire
 * the real LLM call, pass a `runLive` to makeRunner that returns
 * { content, modelUsed, tokensIn, tokensOut }. The prompt + schema are
 * already in place at prompts/practiceQuiz.js + schemas/practiceQuiz.js.
 */

const {makeRunner} = require("./_stubFactory");

const runPracticeQuiz = makeRunner({
  agentId: "practiceQuiz",
  artifactType: "practice_quiz",
  promptFile: "practiceQuiz.js",
});

module.exports = {runPracticeQuiz};
