const {makeRunner} = require("./_stubFactory");

const runFeedback = makeRunner({
  agentId: "feedback",
  artifactType: "feedback",
  promptFile: "feedback.js",
});

module.exports = {runFeedback};
