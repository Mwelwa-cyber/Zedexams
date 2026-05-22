const {makeRunner} = require("./_stubFactory");

const runWeakness = makeRunner({
  agentId: "weakness",
  artifactType: "weakness_report",
  promptFile: "weakness.js",
});

module.exports = {runWeakness};
