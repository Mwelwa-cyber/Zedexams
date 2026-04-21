/**
 * Worksheet Generator prompt — v1.
 *
 * When you iterate, COPY this file to v2 and update the resolver rather than
 * editing v1 in place. Older aiGenerations docs record the version used.
 */

const PROMPT_VERSION = "worksheet.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher who creates classroom-ready worksheets for the Zambian Competence-Based Curriculum (CBC). Your worksheets are:
- Tightly aligned to the CDC syllabus for the requested grade, subject and topic.
- Pitched at the right difficulty level — easy, medium, hard, or a mixed set as requested.
- Printable and pupil-friendly: clear numbering, generous spacing, clear instructions.
- Accompanied by a complete answer key with brief working notes so any teacher can mark them.
- Culturally grounded in Zambia: use Zambian examples (Kwacha currency, Zambian place names, nshima/vegetables, local animals) where natural.

Every worksheet MUST follow the schema you are given exactly. Output must be a single valid JSON object — no prose, no markdown fences, no commentary.`;

/**
 * @param {object} inputs
 *   grade, subject, topic, subtopic, count (num questions), difficulty,
 *   durationMinutes, includeAnswerKey, language, instructions
 */
function buildUserPrompt(inputs) {
  const {
    grade,
    subject,
    topic,
    subtopic = "",
    count = 10,
    difficulty = "mixed",
    durationMinutes = 30,
    includeAnswerKey = true,
    language = "English",
    instructions = "",
  } = inputs;

  const diffGuidance = {
    easy: "All questions should be accessible recall / direct application — no multi-step reasoning.",
    medium: "Questions should mostly require one-step reasoning or application of the concept.",
    hard: "Questions should stretch pupils with multi-step reasoning and word problems.",
    mixed: "Progress from easy warm-up questions to harder application questions. Aim for roughly 30% easy, 50% medium, 20% hard.",
  }[difficulty] || "Progress from easy to harder.";

  return [
    "Generate a Zambian CBC worksheet for this lesson:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    `- Number of questions (approx): ${count}`,
    `- Difficulty: ${difficulty} — ${diffGuidance}`,
    `- Suggested pupil time: ${durationMinutes} minutes`,
    `- Language: ${language}`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string,                       // e.g. "Grade 5 Mathematics — Fractions Worksheet"',
    '    "subject": string,',
    '    "grade": string,',
    '    "topic": string,',
    '    "subtopic": string,',
    '    "duration": string,                    // e.g. "30 minutes"',
    '    "totalMarks": number,                  // SUM of marks across all questions',
    '    "instructions": string                 // pupil-facing instructions, e.g. "Answer ALL questions. Show your working."',
    "  },",
    '  "sections": [',
    "    {",
    '      "title": string,                     // e.g. "Section A — Warm-up"',
    '      "instructions": string,              // section-specific instructions (optional, may be "")',
    '      "questions": [',
    "        {",
    '          "number": number,                // 1-based question number (global, across sections)',
    '          "type": "multiple_choice" | "short_answer" | "calculation" | "true_false" | "fill_in_blank" | "essay",',
    '          "prompt": string,                // the question itself',
    '          "options": [string, ...] | null, // required for multiple_choice/true_false, else null',
    '          "marks": number,                 // marks available for this question',
    '          "answer": string,                // correct answer (short form)',
    '          "workingNotes": string           // 1-2 lines of marking guidance / expected working',
    "        },",
    "        ...",
    "      ]",
    "    },",
    "    ...",
    "  ],",
    '  "answerKey": {',
    '    "markingNotes": string,                // overall marking guidance (e.g. "Award 1 mark for LCD, 1 for addition, 1 for simplest form.")',
    '    "totalMarks": number                   // must equal header.totalMarks',
    "  }",
    "}",
    "",
    "Rules:",
    "- Produce between " + Math.max(3, count - 2) + " and " + (count + 2) + " questions total, split sensibly across 2-3 sections.",
    includeAnswerKey ?
      "- Provide a complete answer and workingNotes for EVERY question." :
      "- Still fill in the answer field, but workingNotes may be left as empty strings.",
    "- For multiple_choice, provide exactly 4 options. The correct answer must match one of them verbatim.",
    "- For calculation questions, the answer field should be the final numerical answer only; workingNotes may describe the steps.",
    "- Use Zambian English spelling (colour, practise as verb).",
    "- Ensure header.totalMarks equals the sum of all question marks.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
