/**
 * Node tests for the SBA task generator's pure pieces: the output schema
 * validator (sbaTaskSchema) and the server taxonomy resolver (sbaTaxonomy).
 *
 * Run: node functions/teacherTools/sbaTask.test.js
 */

const assert = require("node:assert");
const {validateSbaTask} = require("./sbaTaskSchema");
const {
  resolveSbaTaskMeta, isSbaSubject, isSbaGrade, ctsComponentToKbSubject,
} = require("./sbaTaxonomy");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("sbaTaxonomy — resolveSbaTaskMeta");
{
  const m = resolveSbaTaskMeta("english", "reading_comprehension");
  ok("english reading_comprehension → answer_key", m && m.marking === "answer_key");
  ok("english reading_comprehension → 10 marks", m.defaultMarks === 10);
  ok("english reading_comprehension → Reading skill", m.skill === "Reading");

  const speech = resolveSbaTaskMeta("english", "prepared_speech");
  ok("prepared_speech → oral_observation", speech.marking === "oral_observation");

  const maths = resolveSbaTaskMeta("mathematics", "topic_task");
  ok("maths topic_task → method_marks, 20", maths.marking === "method_marks" && maths.defaultMarks === 20);

  const expt = resolveSbaTaskMeta("integrated_science", "experiment");
  ok("science experiment → experiment_rubric", expt.marking === "experiment_rubric");

  const ctsProj = resolveSbaTaskMeta("creative_and_technology_studies", "project");
  ok("cts project → needsComponent + 20", ctsProj.needsComponent === true && ctsProj.defaultMarks === 20);

  const social = resolveSbaTaskMeta("social_studies", "group_discussion");
  ok("social group_discussion → criteria_rubric", social.marking === "criteria_rubric");

  ok("zambian shares english catalogue", resolveSbaTaskMeta("zambian_language", "dictation").marking === "answer_key");
  ok("unknown task → null", resolveSbaTaskMeta("english", "multiple_choice") === null);
  ok("unknown subject → null", resolveSbaTaskMeta("biology", "topic_task") === null);
}

console.log("sbaTaxonomy — grade/subject guards");
{
  ok("G5 is an SBA grade", isSbaGrade("G5"));
  ok("G4 is not an SBA grade", !isSbaGrade("G4"));
  ok("english is an SBA subject", isSbaSubject("english"));
  ok("history is not an SBA subject", !isSbaSubject("history"));
}

console.log("sbaTaxonomy — CTS component → 2013 KB subject");
{
  // The 2013 OBC names the technical strand "Design & Technology".
  ok("technology_studies → design_and_technology",
    ctsComponentToKbSubject("technology_studies") === "design_and_technology");
  ok("home_economics maps 1:1", ctsComponentToKbSubject("home_economics") === "home_economics");
  ok("expressive_arts maps 1:1", ctsComponentToKbSubject("expressive_arts") === "expressive_arts");
}

console.log("sbaTaskSchema — answer-key task validates + totals from questions");
{
  const {ok: valid, value} = validateSbaTask({
    header: {title: "G5 English — Reading Comprehension", taskType: "Reading Comprehension", totalMarks: 99},
    instructions: "Learners read the passage and answer.",
    stimulus: "The environment refers to all the natural things around us...",
    questions: [
      {number: 1, prompt: "What is the environment?", marks: 5, answer: "All natural things around us.", markAllocation: [{description: "any 2 examples", marks: 5}]},
      {number: 2, prompt: "Name two ways people abuse it.", marks: 5, answer: "Cutting trees; dumping rubbish."},
    ],
    markingScheme: {style: "answer_key", notes: "Accept any valid example.", criteria: []},
  });
  ok("valid", valid);
  ok("totalMarks recomputed from questions (10, not 99)", value.header.totalMarks === 10);
  ok("style preserved", value.markingScheme.style === "answer_key");
  ok("questions kept", value.questions.length === 2);
}

console.log("sbaTaskSchema — oral task (no questions) validates on criteria alone");
{
  const {ok: valid, value} = validateSbaTask({
    header: {title: "G5 English — Prepared Speech", taskType: "Prepared Speech"},
    instructions: "Write the debate motion on the board...",
    questions: [],
    markingScheme: {
      style: "oral_observation",
      notes: "Score each learner as they present.",
      criteria: [
        {name: "Fluency", maxMarks: 3, descriptor: "Speaks smoothly."},
        {name: "Pronunciation", maxMarks: 3, descriptor: "Clear sounds."},
        {name: "Content & coherence", maxMarks: 4, descriptor: "Ideas in order."},
      ],
    },
  });
  ok("valid with criteria only", valid);
  ok("total from criteria = 10", value.header.totalMarks === 10);
}

console.log("sbaTaskSchema — rejects an empty task");
{
  const {ok: valid, errors} = validateSbaTask({
    header: {title: "Empty", taskType: "x"},
    questions: [],
    markingScheme: {style: "answer_key", criteria: []},
  });
  ok("invalid", !valid);
  ok("explains why", errors.some((e) => /questions or marking criteria/.test(e)));
}

console.log("sbaTaskSchema — unknown marking style falls back to answer_key");
{
  const {value} = validateSbaTask({
    header: {title: "T", taskType: "t"},
    questions: [{number: 1, prompt: "Q", marks: 2, answer: "A"}],
    markingScheme: {style: "nonsense", criteria: []},
  });
  ok("style normalised", value.markingScheme.style === "answer_key");
}

console.log(`\n✓ sbaTask — all ${passed} assertions passed.`);
