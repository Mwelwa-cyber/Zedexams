/**
 * Assessment prompt — v5.
 *
 * v4 → v5: richer VISUALS. v4 could only ask for a single stem figure via a
 * one-line `diagram` string. v5 replaces that with a structured `visual`
 * object so the model can request the visuals real Zambian papers use:
 *   - stem_figure     — one illustrative figure above the question
 *                       (a djembe drum, a mortar & pestle, a running athlete).
 *   - labelled_figure — a figure whose parts are named, either shown
 *                       ("labeled") or asked for on numbered blanks
 *                       ("identify") — water-filtration apparatus, the
 *                       digestive system (X / Y), arm-pulse positions (1-4).
 *   - option_images   — a multiple-choice question whose options A-D are each
 *                       a drawing (which tool weighs food, which item is NOT
 *                       carved, which shape is a regular hexagon).
 * The legacy string `diagram` is still accepted (treated as a stem_figure) so
 * older callers and cached generations keep working.
 *
 * Still grounded on the verified <curriculum_module> context block when one
 * is present. When iterating, COPY this file to v6 rather than editing v5
 * in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {ASSESSMENT_TYPE_LABELS} = require("./assessmentFormats");

const PROMPT_VERSION = "assessment.v5";

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

Matching questions:
- Use type "matching" for the classic "Match the items in Column A with Column B" exercise: 3-6 items in "left", their partners in "right" (you may add ONE extra distractor to "right"), and "pairs" where pairs[i] is the 0-based index into "right" matching left[i].
- The prompt should read like the real papers: "Match the animals in Column A with their young ones in Column B."
- Score 1 mark per correct pair unless the format says otherwise; the marking guide lists the correct pairings.

VISUALS — when a question needs a picture, set its "visual" object (else leave "visual" null):
- Use visuals the way real Zambian primary papers do — for Science, Home Economics, Expressive Arts (Art/Music/PE), Social Studies and Mathematics shapes/measurement — NOT for questions that are purely verbal. Be selective: only add a visual where a printed exam genuinely shows one.
- The IMAGE NEVER CONTAINS TEXT. Describe only what to draw; all labels go in "labels". An automated illustrator draws clean black-and-white line art from "prompt".
- Pick one "kind":
  - "stem_figure": one illustrative drawing above the question. Example — "The musical instrument shown below is mostly used for ... music." visual = {kind:"stem_figure", prompt:"a traditional African djembe goblet drum, side view"}.
  - "labelled_figure": a figure with named parts. Put the part names in "labels".
    • mode "identify" — the figure's parts are shown as numbers/letters and the learner names them. Example — water purification apparatus: {kind:"labelled_figure", mode:"identify", prompt:"a plastic bottle cut and inverted as a water filter, layers of stones, sand and cloth, water dripping into a cup below", labels:["Dirty water","Small stones","Fine sand","Cloth","Clean water"]}. The digestive-system "What are X and Y?" question is also "identify" with labels ["X","Y"].
    • mode "labeled" — the labels are printed on the figure (use for maths figures with dimensions). Example — area of a parallelogram: {kind:"labelled_figure", mode:"labeled", prompt:"a parallelogram with a vertical dashed height line and a right-angle mark at the base", labels:["12 cm","4 cm"]}.
  - "option_images": a multiple-choice question whose four options are pictures. Keep "options" as the plain letters or short labels, set type "multiple_choice", and give one drawing brief per option in "visual.options". Set "answer" to the correct option LETTER (A, B, C or D). Example — "Which equipment measures the correct weight of food?" visual = {kind:"option_images", options:[{prompt:"a plastic wash basin"},{prompt:"a dial kitchen weighing scale"},{prompt:"a serving spoon"},{prompt:"a cooking saucepan"}]}, answer "B".
- Never describe the figure inside the prompt text — write the question as if the figure is printed beside it ("Study the diagram below.", "The instrument shown below is ...").

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
    '          "type": "multiple_choice"|"short_answer"|"structured"|"calculation"|"true_false"|"essay"|"matching",',
    '          "prompt": string,',
    '          "options": [string, ...],   // only for multiple_choice / true_false',
    '          "left": [string, ...],      // only for matching: Column A items (3-6)',
    '          "right": [string, ...],     // only for matching: Column B (may hold one extra distractor)',
    '          "pairs": [number, ...],     // only for matching: pairs[i] = 0-based index into right matching left[i]',
    '          "marks": number,',
    '          "visual": {                 // ONLY when the question needs a picture; else null. Image holds NO text.',
    '            "kind": "stem_figure"|"labelled_figure"|"option_images",',
    '            "prompt": string,         // what to draw in clean B&W line art (omit for option_images)',
    '            "labels": [string, ...],  // labelled_figure only: the part names / "X","Y" / "1".."4"',
    '            "mode": "labeled"|"identify",   // labelled_figure only',
    '            "options": [{"prompt": string}, ...]  // option_images only: one drawing brief per MCQ option',
    "          } | null,",
    '          "answer": string,           // for option_images, the correct option LETTER (A-D)',
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
    "- Add a \"visual\" only where a real exam would show a picture; leave it null otherwise.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
