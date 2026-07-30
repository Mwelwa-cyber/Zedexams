/**
 * Worksheet Generator prompt — v2.
 *
 * When you iterate, COPY this file to v3 and update the resolver rather than
 * editing v2 in place. Older aiGenerations docs record the version used.
 *
 * v2 adds explicit curriculum awareness: the studio sends an explicit
 * `curriculum` ('cbc' | 'previous') / `framework` ('2023' | '2013') chosen by
 * the teacher, and the worksheet must honour it — CBC uses learner-centred,
 * competence-based language; the Previous (2013) curriculum uses outcome-based
 * language and "pupils". The two must never be mixed.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {subjectNameForGrade} = require("./subjectNaming");
const {MATHS_NOTATION_BLOCK} = require("./notationPromptBlock");

// v3 (edited in place rather than copied): the only change is the shared
// MATHS NOTATION block joining the user prompt and the drill example switching
// from the banned plain form ("7/10 =") to the markup form. The version string
// is what aiGenerations records, so the record stays honest without a 200-line
// duplicate of this file existing only to carry one block.
const PROMPT_VERSION = "worksheet.v3";

const SYSTEM_PROMPT_CBC = `You are an expert Zambian teacher who creates classroom-ready worksheets for the Zambian Competence-Based Curriculum (CBC). Your worksheets are:
- Tightly aligned to the CDC syllabus for the requested grade, subject and topic.
- Pitched at the right difficulty level — easy, medium, hard, or a mixed set as requested.
- Printable and pupil-friendly: clear numbering, generous spacing, clear instructions.
- Accompanied by a complete answer key with brief working notes so any teacher can mark them.
- Culturally grounded in Zambia: use Zambian examples (Kwacha currency, Zambian place names, nshima/vegetables, local animals) where natural.

Every worksheet MUST follow the schema you are given exactly. Output must be a single valid JSON object — no prose, no markdown fences, no commentary.`;

const SYSTEM_PROMPT_PREVIOUS = `You are an expert Zambian teacher who creates classroom-ready worksheets for the Zambian 2013 Previous Curriculum (Outcomes-Based Education). Your worksheets are:
- Tightly aligned to the CDC syllabus for the requested grade, subject and topic, grounded in the syllabus's specific outcomes and objectives.
- Pitched at the right difficulty level — easy, medium, hard, or a mixed set as requested.
- Printable and pupil-friendly: clear numbering, generous spacing, clear instructions.
- Accompanied by a complete answer key with brief working notes so any teacher can mark them.
- Culturally grounded in Zambia: use Zambian examples (Kwacha currency, Zambian place names, nshima/vegetables, local animals) where natural.

Use outcome-based language and refer to the class as "pupils" — this follows the older Zambian curriculum convention. Do NOT use CBC "competence" framing.

Every worksheet MUST follow the schema you are given exactly. Output must be a single valid JSON object — no prose, no markdown fences, no commentary.`;

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
    term = null,
    lessonNumber = null,
    totalLessons = null,
    learningEnvironment = "",
    count = 10,
    difficulty = "mixed",
    durationMinutes = 30,
    includeAnswerKey = true,
    language = "English",
    instructions = "",
    style = "auto",
    gridColumns = 0,
    passageLength = "",
  } = inputs;

  const previous = isPreviousCurriculum(inputs);
  const leLabel = learningEnvironmentLabel(learningEnvironment);
  const heading = previous ?
    "Generate a Zambian Previous-Curriculum (Outcomes-Based) worksheet for this lesson:" :
    "Generate a Zambian CBC worksheet for this lesson:";
  const learnerWord = previous ? "pupils" : "learners";

  // When the teacher explicitly picks a worksheet style, this authoritative
  // directive overrides the model's "choose what suits the topic" judgement.
  // "auto" (or anything unknown) leaves that judgement intact.
  const styleDirective = {
    standard: 'The teacher requires the "Question & answer" style: use layout "standard" for every section with normal numbered questions. Do NOT use grid layout and do NOT add a reading passage.',
    grid: 'The teacher requires the "Practice grid" style: place the items in section(s) with layout "grid" and "columns" 3 or 4, using short "calculation" or "fill_in_blank" prompts, each worth 1 mark. Do NOT add a reading passage.',
    comprehension: 'The teacher requires the "Reading comprehension" style: the first section MUST carry a "passage" (a grade-appropriate reading text) and a short "passageTitle", followed by "short_answer" questions about that passage. Keep its layout "standard".',
    working: 'The teacher requires the "Show working" style: use layout "standard" and set "workingStyle":"columns" on the calculation questions so the printout leaves tall vertical working space for column methods (long division, multi-digit multiplication).',
    matching: 'The teacher requires a "Matching" worksheet: create a section whose "instructions" list a shuffled answer bank (A, B, C, …), and whose questions are "fill_in_blank" items that each begin with a blank for the pupil to write the matching letter (e.g. "____ The capital of Zambia"). Keep layout "standard".',
    word_problems: 'The teacher requires a "Word problems" worksheet: every question is a real-life Zambian word problem (type "short_answer" or "calculation") with "workingStyle":"columns" so pupils can show their working. Use layout "standard".',
    true_false: 'The teacher requires a "True or False" worksheet: every question is type "true_false" with options ["True","False"]. Use layout "standard".',
  }[style] || "";

  // Optional fine-grained controls. Each is an extra rule appended only when the
  // teacher sets it; absent/auto values keep the model's own judgement.
  const gridColumnsDirective = (gridColumns >= 2 && gridColumns <= 4) ?
    `When you use a grid layout, set "columns" to exactly ${gridColumns}.` : "";
  const passageLengthDirective = {
    short: "Any reading passage should be short — about 3-4 sentences.",
    medium: "Any reading passage should be a medium length — about 6-8 sentences.",
    long: "Any reading passage should be longer — about 10-14 sentences.",
  }[passageLength] || "";

  const diffGuidance = {
    easy: "All questions should be accessible recall / direct application — no multi-step reasoning.",
    medium: "Questions should mostly require one-step reasoning or application of the concept.",
    hard: "Questions should stretch pupils with multi-step reasoning and word problems.",
    mixed: "Progress from easy warm-up questions to harder application questions. Aim for roughly 30% easy, 50% medium, 20% hard.",
  }[difficulty] || "Progress from easy to harder.";

  return [
    heading,
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subjectNameForGrade(subject, grade)}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This is Lesson ${lessonNumber} of ${totalLessons} for this ` +
      "sub-topic. Only assess what this lesson covers; do not test " +
      "earlier or later lessons' content." :
      lessonNumber ?
        `- This is Lesson ${lessonNumber} for this sub-topic. Only assess ` +
        "what this lesson covers; don't test later lessons' content." : "",
    leLabel ? `- Learning environment: ${leLabel}` : "",
    `- Number of questions (approx): ${count}`,
    `- Difficulty: ${difficulty} — ${diffGuidance}`,
    `- Suggested pupil time: ${durationMinutes} minutes`,
    `- Language: ${language}`,
    previous ?
      `- Curriculum: Previous (Outcomes-Based). Ground the questions in the ` +
      `lesson's specific outcomes/objectives and refer to the class as ` +
      `"${learnerWord}".` :
      `- Curriculum: CBC (Competency-Based). Ground the questions in the ` +
      `lesson's competences and refer to the class as "${learnerWord}".`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    styleDirective ? `- IMPORTANT — required worksheet format: ${styleDirective}` : "",
    gridColumnsDirective ? `- ${gridColumnsDirective}` : "",
    passageLengthDirective ? `- ${passageLengthDirective}` : "",
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
    '      "passageTitle": string,              // OPTIONAL title of a reading passage, else ""',
    '      "passage": string,                   // OPTIONAL reading passage pupils read before the questions, else ""',
    '      "layout": "standard" | "grid",       // "grid" packs short drill items into columns; default "standard"',
    '      "columns": number,                   // 2-4, only used when layout is "grid"',
    '      "questions": [',
    "        {",
    '          "number": number,                // 1-based question number (global, across sections)',
    '          "type": "multiple_choice" | "short_answer" | "calculation" | "true_false" | "fill_in_blank" | "essay",',
    '          "prompt": string,                // the question itself',
    '          "options": [string, ...] | null, // required for multiple_choice/true_false, else null',
    '          "marks": number,                 // marks available for this question',
    '          "workingStyle": "" | "lines" | "box" | "columns", // working space to leave on the printout (see rules); "" = auto',
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
    "",
    "Layout & format — choose what suits the topic:",
    "- READING COMPREHENSION: put the passage pupils must read in the section's \"passage\" field (and a short \"passageTitle\"), then make the questions \"short_answer\" questions about that passage. Keep that section's layout \"standard\".",
    "- DRILL / PRACTICE SETS (e.g. convert fractions to decimals, times-tables, comparative-adjective fill-ins, mental maths): set the section's layout to \"grid\" with \"columns\": 3 or 4, use short \"calculation\" or \"fill_in_blank\" prompts (e.g. \"\\frac{7}{10} =\" for a fraction drill — the maths notation rules below apply INSIDE drill items too — or \"Poy is ____ than Pam. (tall)\"), and give each item 1 mark. Do NOT leave a passage on a grid section.",
    "- COLUMN ARITHMETIC that needs vertical working (multi-digit column multiplication, long division): keep layout \"standard\" and set the question's \"workingStyle\" to \"columns\" so the printout leaves tall working space. Use \"box\" for a single boxed answer, \"lines\" for a couple of ruled lines, or \"\" to let the format default to the question type.",
    "- Default everything else to layout \"standard\" and workingStyle \"\".",
    "- Use Zambian English spelling (colour, practise as verb).",
    "- Ensure header.totalMarks equals the sum of all question marks.",
    "",
    MATHS_NOTATION_BLOCK,
    "",
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
