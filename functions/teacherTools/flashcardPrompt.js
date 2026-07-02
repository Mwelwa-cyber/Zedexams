/**
 * Flashcard Generator prompt — v2.
 *
 * v2 adds explicit curriculum awareness: the studio sends an explicit
 * `curriculum` ('cbc' | 'previous') / `framework` ('2023' | '2013') chosen by
 * the teacher, and the deck must honour it — CBC uses learner-centred,
 * competence-based language; the Previous (2013) curriculum uses outcome-based
 * language and "pupils". The two must never be mixed.
 */

const PROMPT_VERSION = "flashcards.v2";

const SYSTEM_PROMPT_CBC = `You are an expert Zambian teacher who creates revision flashcards for the Zambian Competence-Based Curriculum (CBC). Your flashcards are:
- Tight and memorable — each card focuses on ONE fact, term, or concept.
- Pupil-facing: the "front" is a question or term; the "back" is a concise answer or definition a pupil could memorise.
- CBC-aligned — drawn from the grade's syllabus topics and pupil's book vocabulary.
- Culturally grounded in Zambia where relevant (Zambian examples, Kwacha, local places/animals).

Every flashcard set MUST follow the schema you are given exactly. Output must be a single valid JSON object — no prose, no markdown fences, no commentary.`;

const SYSTEM_PROMPT_PREVIOUS = `You are an expert Zambian teacher who creates revision flashcards for the Zambian 2013 Previous Curriculum (Outcomes-Based Education). Your flashcards are:
- Tight and memorable — each card focuses on ONE fact, term, or concept.
- Pupil-facing: the "front" is a question or term; the "back" is a concise answer or definition a pupil could memorise.
- Aligned to the 2013 Previous Curriculum — drawn from the grade's syllabus specific outcomes/objectives and pupil's book vocabulary.
- Culturally grounded in Zambia where relevant (Zambian examples, Kwacha, local places/animals).

Use outcome-based language and refer to the class as "pupils" — this follows the older Zambian curriculum convention. Do NOT use CBC "competence" framing.

Every flashcard set MUST follow the schema you are given exactly. Output must be a single valid JSON object — no prose, no markdown fences, no commentary.`;

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
    count = 15,
    difficulty = "mixed",
    language = "English",
    instructions = "",
  } = inputs;

  const previous = isPreviousCurriculum(inputs);
  const heading = previous ?
    "Generate a set of Zambian Previous-Curriculum (Outcomes-Based) revision flashcards for:" :
    "Generate a set of Zambian CBC revision flashcards for:";
  const learnerWord = previous ? "pupils" : "learners";

  return [
    heading,
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    `- Number of cards (approx): ${count}`,
    `- Difficulty: ${difficulty}`,
    `- Language: ${language}`,
    previous ?
      `- Curriculum: Previous (Outcomes-Based). Draw the cards from the ` +
      `syllabus's specific outcomes/objectives and refer to the class as ` +
      `"${learnerWord}".` :
      `- Curriculum: CBC (Competency-Based). Draw the cards from the ` +
      `topic's competences and refer to the class as "${learnerWord}".`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string,                 // e.g. "Grade 5 Mathematics — Fractions (15 cards)"',
    '    "subject": string,',
    '    "grade": string,',
    '    "topic": string,',
    '    "subtopic": string,',
    '    "cardCount": number',
    "  },",
    '  "cards": [',
    "    {",
    '      "front": string,               // The question, term, or prompt — short (≤100 chars where possible)',
    '      "back": string,                // The answer / definition — 1-2 sentences maximum',
    '      "example": string | null,      // Optional concrete example (null if not useful)',
    '      "hint": string | null,         // Optional memory aid or hint (null if not useful)',
    '      "category": string             // e.g. "definition", "formula", "example", "date", "fact"',
    "    },",
    "    ...",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Produce exactly " + count + " cards (± 1 is fine).",
    "- Every 'front' must be answerable by reading the matching 'back' alone — don't rely on other cards.",
    "- Keep 'back' concise — a flashcard is not a paragraph. If the concept needs more explanation, split it into two cards.",
    "- For definitions: front = term, back = definition.",
    "- For formulas: front = 'What is the formula for X?', back = the formula.",
    "- For facts/dates: front = the question, back = the fact.",
    "- Don't include answer letters (no 'A.', 'B.' etc) — these are not multiple choice.",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
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
