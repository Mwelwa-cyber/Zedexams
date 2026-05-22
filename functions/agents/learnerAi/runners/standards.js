const {makeRunner} = require("./_stubFactory");

const runStandards = makeRunner({
  agentId: "standards",
  artifactType: "assessment_standards",
  promptFile: "standards.js",
});

module.exports = {runStandards};
