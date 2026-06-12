/**
 * Assessment prompt — v3.
 *
 * v2 → v3: comprehension becomes first-class. Each section may carry an
 * optional `passage` object ({title, text}) — an ORIGINAL reading passage
 * the section's questions refer to — so English-style comprehension
 * sections land in the Assessment Studio as proper passage blocks instead
 * of text squeezed into question stems. (v2 added the profile-driven
 * format block and per-question diagram briefs; both unchanged here.)
 *
 * Still grounded on the verified <curriculum_module> context block when one
 * is present. When iterating, COPY this file to v4 rather than editing v3
 * in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {ASSESSMENT_TYPE_LABELS} = require("./assessmentFormats");

const PROMPT_VERSION = "assessment.v3";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and examiner writing a formal CBC ASSESSMENT (a graded test).

Your assessment:
- Follows the Zambian paper format it is given. When an <assessment_format_context> block is provided, it is the AUTHORITATIVE paper format: reproduce its section names and headings, its instruction wording, its numbering convention and its marks distribution exactly. Scale the number of questions to the requested total marks while keeping each section's share of the marks. Match the register of its style exemplars but NEVER copy them.
- Shows marks per question with a total that adds up.
- Progresses from straightforward recall to higher-order application, matched to the grade.
- Has a complete marking scheme: the correct answer and a brief marking guide for every question (what earns the marks).
- Uses Zambian context (kwacha, local places, nshima/markets) where natural.

Comprehension passages:
- When the paper needs a reading comprehension section (the format requires one, or the teacher asks for it), write an ORIGINAL short passage (about 100-160 words for primary, longer for secondary) in that section's "passage" object — set in a Zambian or familiar African context at the grade's reading level — and make every question in that section answerable from the passage.
- NEVER copy or closely adapt a published story or textbook passage. Write fresh.
- Sections that need no passage set "passage" to null.

Diagrams:
- Set the question's "diagram" field ONLY when the question genuinely needs a visual (a labelled figure, map, graph, table or apparatus). Write a one-sentence brief of exactly what the teacher should draw or attach, including the required labels.
- Never describe the diagram inside the question prompt itself — write the prompt as if the figure is printed beside it (e.g. "Study the diagram below.").
- Leave "diagram" as null for questions that need no visual.

Hard rules:
- If a verified curriculum module is provided in context, assess ONLY its outcomes/content — nothing beyond it or from later lessons.
- Respect the lesson-in-a-series framing (Lesson N of M) when given.
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
    totalMarks = 20,
    durationMinutes = 40,
    language = "English",
    instructions = "",
    assessmentType = "topic_test",
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessmentType] || "Topic Test";

  return [
    "Write a formal Zambian CBC ASSESSMENT for the following:",
    "",
    `- Assessment type: ${typeLabel}`,
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This assesses Lesson ${lessonNumber} of ${totalLessons} for this ` +
      "sub-topic. Assess only what that lesson covered." :
      lessonNumber ?
        `- Assesses Lesson ${lessonNumber} of this sub-topic.` : "",
    leLabel ? `- The lesson was delivered in: ${leLabel}.` : "",
    `- Target total marks: ${totalMarks}`,
    `- Duration: ${durationMinutes} minutes`,
    `- Language: ${language}`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string, "grade": string, "subject": string,',
    '    "topic": string, "subtopic": string, "term": number,',
    '    "durationMinutes": number, "totalMarks": number,',
    '    "instructions": string',
    "  },",
    '  "sections": [',
    "    {",
    '      "title": string, "instructions": string,',
    '      "passage": {"title": string, "text": string} | null,  // ORIGINAL reading passage when this is a comprehension section; else null',
    '      "questions": [',
    "        {",
    '          "number": number,',
    '          "type": "multiple_choice"|"short_answer"|"structured"|"calculation"|"true_false"|"essay",',
    '          "prompt": string,',
    '          "options": [string, ...],   // only for multiple_choice / true_false',
    '          "marks": number,',
    '          "diagram": string|null,     // ONLY if a figure is needed: one-line brief of what to draw/attach, with labels',
    '          "answer": string,',
    '          "markingGuide": string',
    "        }",
    "      ]",
    "    }",
    "  ],",
    '  "markingScheme": { "notes": string }',
    "}",
    "",
    "Rules:",
    "- Every question MUST have marks, a correct answer and a marking guide.",
    "- Marks must sum to a sensible total close to the target.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
