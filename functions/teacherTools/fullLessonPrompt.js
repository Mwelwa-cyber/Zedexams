/**
 * Full Lesson prompt — v1.
 *
 * Produces a single, self-contained lesson a Zambian CBC teacher can deliver
 * end to end. When a verified <curriculum_module> context block is present
 * (the resolver injects it for a stored sub-topic module), the lesson MUST be
 * built strictly on it. When iterating, COPY this file to v2 rather than
 * editing v1 in place — aiGenerations docs record the version used.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");

const PROMPT_VERSION = "full_lesson.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher writing a COMPLETE, ready-to-deliver lesson aligned to the Zambian Competence-Based Curriculum (CBC).

The lesson you write is everything a teacher needs for one period:
- Clear objectives stated as what learners will be able to do.
- Key vocabulary with pupil-friendly definitions.
- An engaging, real-life Zambian hook and a check of prior knowledge.
- The core content TAUGHT — explained for the learners at their grade level, not just listed. Use simple language, local examples (kwacha, nshima, local markets, Zambian places) where natural.
- Fully worked examples with every step shown (for quantitative subjects; for others use concrete demonstrations instead).
- Guided practice (teacher-led) then independent learner activities.
- Short formative checks WITH an answer key.
- A concise summary/consolidation and a homework task with an answer guide.

Hard rules:
- If a verified curriculum module is provided in context, treat it as the single source of truth: cover its outcomes, use its content/vocabulary/activities, and do NOT invent material beyond it.
- Respect the lesson-in-a-series framing (Lesson N of M): teach only this lesson's share, build on earlier lessons without repeating them, and do not pre-empt later lessons.
- Shape activities and materials to the stated learning environment.
- Age-appropriate, Zambian English spelling, encouraging teacher voice.
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
    durationMinutes = 40,
    language = "English",
    instructions = "",
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);

  return [
    "Write a COMPLETE Zambian CBC lesson for the following:",
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This is Lesson ${lessonNumber} of ${totalLessons} for this ` +
      "sub-topic. Teach only this lesson's share; build on Lessons 1.." +
      (lessonNumber - 1) + " without repeating them, and do not pre-empt " +
      "later lessons." :
      lessonNumber ?
        `- This is Lesson ${lessonNumber} for this sub-topic.` : "",
    leLabel ? `- Learning environment: ${leLabel} — shape activities and ` +
      "materials to genuinely fit this setting." : "",
    `- Lesson duration: ${durationMinutes} minutes`,
    `- Medium of instruction: ${language}`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string, "grade": string, "subject": string,',
    '    "topic": string, "subtopic": string, "term": number,',
    '    "durationMinutes": number, "language": string',
    "  },",
    '  "objectives": [string, ...],          // 2-4, "Learners will be able to…"',
    '  "keyVocabulary": [ { "term": string, "definition": string } ],',
    '  "introduction": { "hook": string, "priorKnowledge": string },',
    '  "teaching": [',
    '    { "heading": string, "explanation": string }   // 3-6, the content TAUGHT for learners',
    "  ],",
    '  "workedExamples": [',
    '    { "problem": string, "steps": [string, ...], "answer": string }   // 0-4',
    "  ],",
    '  "guidedPractice": [string, ...],       // 2-5 teacher-led steps',
    '  "learnerActivities": [string, ...],    // 2-5 things pupils do',
    '  "assessment": {',
    '    "checks": [string, ...],             // 3-5 short formative checks',
    '    "answers": [string, ...]             // matching answer key',
    "  },",
    '  "summary": string,                     // consolidation / wrap-up',
    '  "homework": { "task": string, "answerGuide": string },',
    '  "references": [string, ...],           // 0-3 (Pupil\'s Book chapter, syllabus page)',
    '  "coveredContent": [string, ...]        // 3-6 short bullets naming exactly what THIS lesson teaches, so later lessons of the sub-topic don\'t repeat it',
    "}",
    "",
    "Rules:",
    "- Teach the content — explanations must be full enough that a learner",
    "  reading them would understand, not just topic labels.",
    "- Worked-example steps must each be a real step toward the answer.",
    "- checks[] and answers[] must correspond one-to-one.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
