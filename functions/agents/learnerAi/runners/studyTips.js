const {makeRunner} = require("./_stubFactory");

const runStudyTips = makeRunner({
  agentId: "studyTips",
  artifactType: "study_tips",
  promptFile: "studyTips.js",
});

module.exports = {runStudyTips};
