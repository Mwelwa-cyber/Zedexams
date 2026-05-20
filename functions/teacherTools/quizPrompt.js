/**
 * Quiz prompt — v1.
 *
 * A short, mostly auto-checkable formative quiz grounded on the verified
 * <curriculum_module> context block when one is present. When iterating,
 * COPY this file to v2 rather than editing v1 in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");

const PROMPT_VERSION = "quiz.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher writing a short formative QUIZ for the Competence-Based Curriculum (CBC).

Your quiz:
- Is mostly multiple-choice (4 options) with a few true/false or one-word short-answer items, so a teacher can mark it quickly.
- Has exactly one unambiguous correct answer per question and a one-line explanation of why it is correct.
- Progresses from easy recall to light application, pitched at the grade.
- Uses Zambian context (kwacha, local places, nshima/markets) where natural.

Hard rules:
- If a verified curriculum module is provided in context, quiz ONLY its outcomes/content — nothing beyond it or from later lessons.
- Respect the lesson-in-a-series framing (Lesson N of M) when given.
- For multiple_choice, "correctAnswer" must be the full text of the correct option (and that text must appear in "options"). For true_false, options are ["True","False"].
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
    count = 10,
    durationMinutes = 15,
    language = "English",
    instructions = "",
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);

  return [
    "Write a short Zambian CBC formative QUIZ for the following:",
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This quizzes Lesson ${lessonNumber} of ${totalLessons} for this ` +
      "sub-topic. Quiz only what that lesson covered." :
      lessonNumber ?
        `- Quizzes Lesson ${lessonNumber} of this sub-topic.` : "",
    leLabel ? `- The lesson was delivered in: ${leLabel}.` : "",
    `- Number of questions (approx): ${count}`,
    `- Target time: ${durationMinutes} minutes`,
    `- Language: ${language}`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string, "grade": string, "subject": string,',
    '    "topic": string, "subtopic": string, "term": number,',
    '    "durationMinutes": number, "instructions": string',
    "  },",
    '  "questions": [',
    "    {",
    '      "number": number,',
    '      "type": "multiple_choice" | "true_false" | "short_answer",',
    '      "question": string,',
    '      "options": [string, ...],   // 4 for multiple_choice; ["True","False"] for true_false; [] for short_answer',
    '      "correctAnswer": string,    // full text of the correct option',
    '      "explanation": string       // one line: why it is correct',
    "    }",
    "  ],",
    '  "answerKey": { "notes": string }   // optional brief marking note',
    "}",
    "",
    "Rules:",
    "- Every question MUST have exactly one correct answer + an explanation.",
    "- correctAnswer for multiple_choice/true_false must match one option exactly.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
