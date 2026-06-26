/**
 * SBA task generator prompt — v1.
 *
 * Produces ONE ECZ-compliant School Based Assessment task (Grades 5–7) with
 * its marking scheme, grounded on the syllabus outcome and pitched at the
 * requested Bloom level. The marking artefact is dictated by the task's
 * marking style: written answer keys, oral observation sheets, maths method
 * marks, or the fixed ECZ experiment/project/competence/criteria rubrics.
 *
 * Hard rules from the guidelines: SBA tasks must derive from the authorised
 * syllabus, must NOT use multiple-choice questions, and must let learners
 * demonstrate the skill (write/speak/do), not just recognise an answer.
 */

const {sbaDiagramReference} = require("./sbaDiagrams");

const PROMPT_VERSION = "sba_task.v2";

const SYSTEM_PROMPT = `You are an expert Zambian upper-primary teacher who sets School Based Assessment (SBA) tasks for Grades 5, 6 and 7, exactly as required by the Examinations Council of Zambia (ECZ) "Guidelines for the Administration of School Based Assessment at Primary School Level".

Non-negotiable rules:
- SBA tasks are derived from the authorised Zambian syllabus and assessed in a natural learning environment as part of teaching and learning.
- NEVER use multiple-choice questions (MCQs). SBA tasks must require the learner to DEMONSTRATE the skill — write, speak, calculate, draw, perform or investigate — not pick an option.
- Every task is plotted against Bloom's Taxonomy (Knowledge, Comprehension, Application, Analysis, Synthesis, Evaluation); pitch sub-tasks at the requested cognitive level(s).
- Provide a complete marking scheme in the exact style required for the task type so that a second teacher would award the same marks.
- Use Zambian English spelling and Zambian contexts, names and examples (e.g. nshima, Lusaka, kwacha, maize, the Zambezi).
- Keep the two audiences separate. \`instructions\` is written FOR THE LEARNER and printed on the task sheet ("Answer all the questions in the spaces provided. Write in full sentences."). \`administration\` is written FOR THE TEACHER — how to set up, hand out, time and run the task — and is NEVER shown to the learner; it sits with the marking scheme. Put nothing teacher-facing in \`instructions\`.
- Where a figure makes the task clearer or is the point of the task (a maths shape with its dimensions, a science apparatus to label, a graph the learner reads values off), attach a library figure rather than describing it in words.

Your output MUST be a single structured object emitted through the provided tool. No prose or commentary outside the tool call.`;

// The fixed ECZ marking artefacts, reproduced so the model uses them verbatim
// where the guidelines prescribe a specific rubric.
const MARKING_GUIDANCE = {
  answer_key:
    "ANSWER KEY. Write short-response / structured questions (NO multiple choice). " +
    "For each question give the model answer and a `markAllocation` breakdown showing how the marks are earned. " +
    "Put the marking scheme summary in markingScheme.notes; leave markingScheme.criteria empty.",
  oral_observation:
    "ORAL OBSERVATION SHEET. This is a speaking/reading-aloud task with NO written answers. " +
    "Leave `questions` empty. In `instructions` give the learner the task ('You will talk for 3–5 minutes about …'). In `administration` tell the teacher exactly how to run the task (what to say/write on the board, time allowed — individual presentations run 3–5 minutes). " +
    "Provide markingScheme.criteria as the observation sheet the teacher scores each learner on " +
    "(e.g. Fluency; Pronunciation & clarity; Intonation, stress & voice projection; Range & accuracy of vocabulary/structures; Coherence & content), with marks summing to the total.",
  method_marks:
    "METHOD MARKS (Mathematics). Build ONE topic task made of several sub-tasks of increasing difficulty. " +
    "For each sub-task give the worked solution as the `answer` and a `markAllocation` that awards METHOD marks for correct stages/formulae and an ACCURACY mark for the correct final answer (and marks for correct diagrams/measurements where relevant). " +
    "Note in markingScheme.notes that omission of essential working loses marks and alternative correct methods are accepted.",
  experiment_rubric:
    "EXPERIMENT (Integrated Science). In `stimulus` give the Materials and Method the learner follows; in `instructions` tell the LEARNER what to do; in `administration` tell the teacher how to set up and administer it; record sheets and follow-up questions go in `questions` if needed. " +
    "markingScheme.criteria MUST be the ECZ experiment rubric (total 10): " +
    "Knowledge of materials to be used (1); Following instructions and procedures (2); Taking correct readings/observations (2); Recording correct readings/observations (2); Explaining the scientific meaning of readings/observations (2); Drawing correct conclusion based on findings (1).",
  project_rubric:
    "PROJECT. In `instructions` give the learner the project brief and expected report layout (Title, Aim, Materials, Method, Observations/Results, Explanation, Conclusion); put any teacher set-up / timing / supervision notes in `administration`. " +
    "For Integrated Science use the ECZ project rubric (total 10): Knowledge of materials (2); Procedure (2); Recording correct readings/observations (2); Explaining of observations/results (2); Drawing correct conclusion (2). " +
    "For a CTS project, score against the relevant key competences (Creativity, Critical thinking, Problem-solving, Manipulation, Entrepreneurship) with marks summing to the total.",
  competence_rubric:
    "CTS COMPETENCE RUBRIC. Set a written or practical task for the named CTS component. " +
    "markingScheme.criteria should score the ECZ key competences relevant to the task " +
    "(Creativity, Critical thinking, Problem-solving, Manipulation, Interpretation, Logical sequencing, Entrepreneurship), with marks summing to the total.",
  criteria_rubric:
    "CRITERIA RUBRIC (Social Studies / Composition). markingScheme.criteria should be the marking points the ECZ guidelines use for this task type " +
    "— e.g. for a project: ability to gather facts, map/diagram skills, written presentation (neatness, logical flow); " +
    "for a written assignment: Structure, Facts, Logical flow of facts; " +
    "for a group discussion: Participation, Ability to discuss facts, Logical flow — with marks summing to the total.",
};

function buildUserPrompt(inputs) {
  const {
    gradeLabel = "Grade 5",
    subjectLabel = "",
    taskTypeLabel = "",
    marking = "answer_key",
    component = "",
    skill = "",
    term = "",
    topic = "",
    outcome = "",
    bloomLevel = "",
    totalMarks = 10,
    language = "English",
    instructions = "",
  } = inputs;

  const guidance = MARKING_GUIDANCE[marking] || MARKING_GUIDANCE.answer_key;

  return [
    "Create ONE School Based Assessment (SBA) task for:",
    "",
    `- Grade: ${gradeLabel}`,
    `- Subject: ${subjectLabel}`,
    component ? `- CTS component: ${component}` : "",
    skill ? `- Language skill: ${skill}` : "",
    `- Task type: ${taskTypeLabel}`,
    term ? `- Term: ${term}` : "",
    topic ? `- Topic / focus: ${topic}` : "",
    outcome ? `- Syllabus outcome(s) to assess: ${outcome}` : "",
    bloomLevel ? `- Target Bloom level: ${bloomLevel}` : "",
    `- Total marks: ${totalMarks}`,
    `- Language of the task: ${language}`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    `Marking style: ${guidance}`,
    "",
    "Emit a single object with these keys (omit nothing — use \"\" or [] when not applicable):",
    "{",
    '  "header": {',
    '    "title": string,            // e.g. "Grade 5 English — Reading Comprehension (SBA Task)"',
    '    "subject": string,',
    '    "grade": string,',
    '    "taskType": string,',
    '    "component": string,        // CTS component, else ""',
    '    "skill": string,            // language skill (Listening & Speaking / Reading / Writing), else ""',
    '    "term": string,',
    '    "duration": string,         // e.g. "3–5 minutes" for speech, else ""',
    '    "totalMarks": number,       // MUST equal the marks available in the task',
    '    "bloomLevels": [string],    // from: Knowledge, Comprehension, Application, Analysis, Synthesis, Evaluation',
    '    "outcomeRefs": [string]     // syllabus outcome codes you assessed, if known (e.g. "5.7.2")',
    "  },",
    '  "instructions": string,       // LEARNER-facing — printed on the task sheet (what the learner must do)',
    '  "administration": string,     // TEACHER-facing — how to set up / hand out / time / run the task; NEVER shown to the learner',
    '  "stimulus": string,           // passage / data / dialogue / experiment method the learner works from, else ""',
    '  "stimulusDiagram": { "libraryKey": string, "params": {object} },  // optional library figure shown with the stimulus, else omit',
    '  "questions": [',
    '    { "number": number, "prompt": string, "marks": number, "answer": string,',
    '      "diagram": { "libraryKey": string, "params": {object} },  // optional library figure printed with this question, else omit',
    '      "markAllocation": [ { "description": string, "marks": number } ] }',
    "  ],",
    '  "markingScheme": {',
    '    "style": string,            // one of: answer_key | oral_observation | method_marks | experiment_rubric | project_rubric | competence_rubric | criteria_rubric',
    '    "notes": string,            // overall marking guidance',
    '    "criteria": [ { "name": string, "maxMarks": number, "descriptor": string } ]',
    "  }",
    "}",
    "",
    "",
    "DIAGRAMS — attach a deterministic library figure with \"libraryKey\" + \"params\" rather than describing it in words. Use it on a question (`questions[].diagram`) or with the stimulus (`stimulusDiagram`). Use ONLY these exact keys and the params listed; omit the field when no figure is needed. Never describe the figure inside the prompt text — write the question as if the figure is printed beside it (\"Study the diagram below.\"). Available figures:",
    sbaDiagramReference(),
    "Examples — label the parts of a plant cell: \"diagram\": {\"libraryKey\":\"plantcell\"}. Area of a parallelogram: \"diagram\": {\"libraryKey\":\"parallelogramh\", \"params\":{\"base\":\"12 cm\",\"height\":\"4 cm\"}}. Read a bar chart: \"diagram\": {\"libraryKey\":\"barchart\", \"params\":{\"labels\":\"Mon,Tue,Wed\",\"values\":\"12,18,9\"}}.",
    "",
    "Rules:",
    `- The marks available in the task MUST total exactly ${totalMarks}.`,
    `- Set markingScheme.style to "${marking}".`,
    "- NO multiple-choice questions anywhere.",
    "- Keep it pitched for the grade and authentically Zambian.",
    "- Return ONLY the tool object. No markdown, no commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt, MARKING_GUIDANCE};
