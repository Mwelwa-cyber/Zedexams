const {makeRunner} = require("./_stubFactory");

const runExamQuiz = makeRunner({
  agentId: "examQuiz",
  artifactType: "exam_quiz",
  promptFile: "examQuiz.js",
});

module.exports = {runExamQuiz};
