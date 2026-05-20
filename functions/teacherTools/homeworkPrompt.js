/**
 * Homework prompt — v1.
 *
 * Short take-home practice grounded on the verified <curriculum_module>
 * context block when one is present. When iterating, COPY this file to v2
 * rather than editing v1 in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");

const PROMPT_VERSION = "homework.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher setting HOMEWORK — short take-home practice a learner does independently.

Your homework:
- Is short and focused: a handful of questions a pupil can finish at home in the stated time, mostly recall and one-step application of what was taught this lesson.
- Has a clear pupil-facing instruction and a brief note to the parent/guardian on how they can help (without doing it for the child).
- Includes a complete answer key with short working notes so any teacher can mark it quickly.
- Uses Zambian context (kwacha, nshima, local markets, Zambian place names) where natural.

Hard rules:
- If a verified curriculum module is provided in context, set ONLY on what that lesson covers — do not assess material beyond it or from later lessons.
- Respect the lesson-in-a-series framing (Lesson N of M).
- Age-appropriate, Zambian English spelling.
- Output a SINGLE valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

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

  const leLabel = learningEnvironmentLabel(learningEnvironment);

  return [
    "Set Zambian CBC HOMEWORK for the following:",
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
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
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
