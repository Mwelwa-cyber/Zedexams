/**
 * Homework prompt — v2.
 *
 * Short take-home practice grounded on the verified <curriculum_module>
 * context block when one is present. When iterating, COPY this file to v3
 * rather than editing v2 in place.
 *
 * v2 adds explicit curriculum awareness: the studio now sends an explicit
 * `curriculum` ('cbc' | 'previous') / `framework` ('2023' | '2013') chosen by
 * the teacher, and the homework must honour it — CBC uses learner-centred,
 * competence-based language; the Previous curriculum uses outcome-based
 * language and "pupils". The two must never be mixed.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {subjectNameForGrade} = require("./subjectNaming");
const {MATHS_NOTATION_BLOCK} = require("./notationPromptBlock");

// v3 (edited in place): the only change is the shared MATHS NOTATION block
// joining the user prompt. Edited in place because the version string is
// what aiGenerations records, and a full file copy existing only to carry
// one shared block is the duplication the block ends.
const PROMPT_VERSION = "homework.v3";

const SYSTEM_PROMPT_CBC = `You are an expert Zambian teacher setting HOMEWORK — short take-home practice a learner does independently, aligned to the 2023 Competency-Based Curriculum (CBC).

Your homework:
- Is short and focused: a handful of questions a learner can finish at home in the stated time, mostly recall and one-step application of what was taught this lesson.
- Develops the lesson's competences (what learners can DO), not just recall of facts.
- Has a clear learner-facing instruction and a brief note to the parent/guardian on how they can help (without doing it for the child).
- Includes a complete answer key with short working notes so any teacher can mark it quickly.
- Uses Zambian context (kwacha, nshima, local markets, Zambian place names) where natural.

Hard rules:
- If a verified curriculum module is provided in context, set ONLY on what that lesson covers — do not assess material beyond it or from later lessons.
- Respect the lesson-in-a-series framing (Lesson N of M).
- Use learner-centred, competence-based language. Say "learners" (not "pupils").
- Age-appropriate, Zambian English spelling.
- Output a SINGLE valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

const SYSTEM_PROMPT_PREVIOUS = `You are an expert Zambian teacher setting HOMEWORK — short take-home practice a pupil does independently, aligned to the 2013 Previous Curriculum (Outcomes-Based Education).

Your homework:
- Is short and focused: a handful of questions a pupil can finish at home in the stated time, mostly recall and one-step application of what was taught this lesson.
- Is grounded on the lesson's specific outcomes and objectives (what pupils should be able to do), in the outcome-based tradition.
- Has a clear pupil-facing instruction and a brief note to the parent/guardian on how they can help (without doing it for the child).
- Includes a complete answer key with short working notes so any teacher can mark it quickly.
- Uses Zambian context (kwacha, nshima, local markets, Zambian place names) where natural.

Hard rules:
- If a verified curriculum module is provided in context, set ONLY on what that lesson covers — do not assess material beyond it or from later lessons.
- Respect the lesson-in-a-series framing (Lesson N of M).
- Use outcome-based language. Say "pupils" (not "learners") — this follows the older Zambian curriculum convention. Do NOT use CBC "competence" framing.
- Age-appropriate, Zambian English spelling.
- Output a SINGLE valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

// Backward-compatible default alias (CBC).
const SYSTEM_PROMPT = SYSTEM_PROMPT_CBC;

/** True when the teacher chose the Previous (2013 / outcome-based) curriculum. */
function isPreviousCurriculum(inputs = {}) {
  return String(inputs.curriculum || "").toLowerCase() === "previous" ||
    String(inputs.framework || "") === "2013";
}

/** Select the system prompt for the chosen curriculum. */
function pickSystemPrompt(inputs = {}) {
  return isPreviousCurriculum(inputs) ? SYSTEM_PROMPT_PREVIOUS : SYSTEM_PROMPT_CBC;
}

function buildUserPrompt(inputs) {
  const {
    grade,
    subject,
    topic,
    subtopic = "",
    term = null,
    lessonNumber = null,
    totalLessons = null,
    learningEnvironment = "",
    count = 6,
    estimatedMinutes = 20,
    language = "English",
    instructions = "",
  } = inputs;

  const previous = isPreviousCurriculum(inputs);
  const leLabel = learningEnvironmentLabel(learningEnvironment);
  const heading = previous ?
    "Set Zambian Previous-Curriculum (Outcomes-Based) HOMEWORK for the following:" :
    "Set Zambian CBC HOMEWORK for the following:";
  const learnerWord = previous ? "pupils" : "learners";

  return [
    heading,
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subjectNameForGrade(subject, grade)}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This is the homework for Lesson ${lessonNumber} of ${totalLessons} ` +
      "for this sub-topic. Only set work on what this lesson covered." :
      lessonNumber ?
        `- Homework for Lesson ${lessonNumber} of this sub-topic.` : "",
    leLabel ? `- The lesson was delivered in: ${leLabel}.` : "",
    `- Number of questions (approx): ${count}`,
    `- Target time at home: ${estimatedMinutes} minutes`,
    `- Language: ${language}`,
    previous ?
      `- Curriculum: Previous (Outcomes-Based). Ground the questions in the ` +
      `lesson's specific outcomes/objectives and refer to the class as ` +
      `"${learnerWord}".` :
      `- Curriculum: CBC (Competency-Based). Ground the questions in the ` +
      `lesson's competences and refer to the class as "${learnerWord}".`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string, "grade": string, "subject": string,',
    '    "topic": string, "subtopic": string, "term": number,',
    '    "estimatedMinutes": number, "language": string',
    "  },",
    '  "instructions": string,           // one short pupil-facing instruction',
    '  "questions": [',
    '    { "number": number, "prompt": string, "answer": string, "workingNotes": string }',
    "  ],",
    '  "parentNote": string,             // 1-2 sentences for the guardian',
    '  "answerKey": { "markingNotes": string }',
    "}",
    "",
    "Rules:",
    "- Every question MUST have a correct answer in the answer key.",
    "- Keep it doable at home without special materials.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
    "",
    MATHS_NOTATION_BLOCK,
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_CBC,
  SYSTEM_PROMPT_PREVIOUS,
  pickSystemPrompt,
  isPreviousCurriculum,
  buildUserPrompt,
};
