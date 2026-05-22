const {makeRunner} = require("./_stubFactory");

const runNotes = makeRunner({
  agentId: "notes",
  artifactType: "notes",
  promptFile: "notes.js",
});

module.exports = {runNotes};
