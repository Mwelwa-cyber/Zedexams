/**
 * Assessment prompt — v6.
 *
 * v5 → v6: maths fidelity. v5 could request exact library figures but said
 * nothing about how to WRITE the maths in the question text, so fractions
 * arrived as plain "1/3", indices as "x2", and column sums as ASCII — all of
 * which print like rough notes rather than an exam paper. v6 adds a MATHS
 * NOTATION section that pins the LLM to the same lightweight markup the editor's
 * importer already understands (`\frac{a}{b}`, `$…$`, `[[vmath …]]`), so the
 * studio converts it into stacked fractions, KaTeX and column arithmetic. The
 * `clockface` and `protractor` figures (added to the shape library) are now
 * available for time/angle questions.
 *
 * Everything else is carried over from v5 verbatim: the structured `visual`
 * object (stem_figure / labelled_figure / option_images), exact maths figures
 * (shape / shape_options), original comprehension passages and matching
 * questions. The schema is unchanged (assessmentSchema v1.4).
 *
 * Still grounded on the verified <curriculum_module> context block when one
 * is present. When iterating, COPY this file to v7 rather than editing v6
 * in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {ASSESSMENT_TYPE_LABELS} = require("./assessmentFormats");
const {shapeLibraryReference} = require("./assessmentShapes");

const PROMPT_VERSION = "assessment.v6";

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

MATHS NOTATION — write every piece of maths the way it should PRINT, not as rough ASCII. This applies to the question text, the options, and the marking guide:
- Fractions: ALWAYS write \\frac{a}{b} (e.g. \\frac{1}{3}, \\frac{2}{5}). Mixed numbers: put the whole number directly before the fraction — c\\frac{a}{b} (e.g. 2\\frac{1}{4}). NEVER write a fraction as "1/3".
- Other inline maths — square roots, powers/indices, decimals in standard form, ratios, symbols — wrap in single dollar signs: $\\sqrt{49}$, $x^{2}$, $3.2\\times10^{4}$, $\\pi r^{2}$.
- Column (vertical) addition or subtraction shown stacked: put it on its OWN line as a token [[vmath op=- lines=954751,362948 answer=591803]] — op is + - × or ÷, "lines" are the operands top-to-bottom, "answer" is optional (omit it to leave the sum for the learner). Use this whenever a real paper shows a sum written in columns.
- Use this notation INSIDE multiple-choice options too: if the options are fractions, each option is a \\frac{...}{...} (e.g. options ["\\frac{3}{15}", "\\frac{8}{15}", "\\frac{11}{15}", "\\frac{3}{8}"]).

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

EXACT MATHS FIGURES — for Mathematics shapes, measurement, solids, Venn diagrams, number lines, coordinate grids, mappings, clocks, angles and bar/pie/line graphs, DO NOT use a drawn picture. Use an EXACT library figure so dimensions and labels are precise:
- "shape": a library figure on the stem — {kind:"shape", libraryKey:"...", params:{...}}.
- "shape_options": a picture MCQ whose options are library shapes — type "multiple_choice", {kind:"shape_options", options:[{libraryKey,params}, ...]}, "answer" = the correct LETTER.
Available libraryKeys (use these exact keys and only the params listed):
${shapeLibraryReference()}
Examples — area of a parallelogram: {kind:"shape", libraryKey:"parallelogramh", params:{base:"12 cm", height:"4 cm"}}. Volume of a box: {kind:"shape", libraryKey:"cuboid", params:{l:"10 cm", w:"3 cm", h:"2 cm"}}. Circumference of a circle: {kind:"shape", libraryKey:"circle", params:{radius:"6 cm", center:"O"}}. "Which shape is a regular hexagon?": {kind:"shape_options", options:[{libraryKey:"square"},{libraryKey:"rhombus"},{libraryKey:"hexagon"},{libraryKey:"pentagon"}]}, answer "C". "How many elements are in A∩B?": {kind:"shape", libraryKey:"vennelements", params:{a:"A", b:"B", onlyA:"1,2,3", both:"4,5", onlyB:"6,7,8", outside:"9"}}. Telling the time: {kind:"shape", libraryKey:"clockface", params:{hour:"3", minute:"15"}}. Reading an angle: {kind:"shape", libraryKey:"protractor", params:{angle:"60"}}. A graph the learner reads values off: {kind:"shape", libraryKey:"linegraph", params:{labels:"1,2,3,4,5,6,7", values:"40,50,20,60,30,40,30", cap:"Books per grade"}}. Integer arithmetic "Work out -3 + 5 using the number line": {kind:"shape", libraryKey:"numberlinejump", params:{min:"-5", max:"5", jumps:"-3>2"}}.

Hard rules:
- Do NOT bake structural labels into the text: option strings carry ONLY the choice ("respiratory system", not "C. respiratory system"); section "title" carries ONLY the section name ("Multiple Choice", not "SECTION A: Multiple Choice"); and "header.instructions" carries ONLY the instruction prose ("Answer ALL questions."), never a NAME/DATE/TOTAL MARKS header — the paper draws those automatically.
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
    '          "visual": {                 // ONLY when the question needs a picture; else null. Drawn images hold NO text.',
    '            "kind": "stem_figure"|"labelled_figure"|"option_images"|"shape"|"shape_options",',
    '            "prompt": string,         // drawn kinds: what to draw in clean B&W line art (omit for option_images/shape/shape_options)',
    '            "labels": [string, ...],  // labelled_figure only: the part names / "X","Y" / "1".."4"',
    '            "mode": "labeled"|"identify",   // labelled_figure only',
    '            "libraryKey": string,     // shape only: an EXACT maths library key (see the list in the instructions)',
    '            "params": {object},       // shape only: the shape\'s label/value params',
    '            "options": [ {"prompt": string} | {"libraryKey": string, "params": {object}} ]  // option_images: {prompt} each; shape_options: {libraryKey,params} each',
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
    "- Write fractions as \\\\frac{a}{b} and other maths in $…$ — never plain ASCII like \"1/3\".",
    "- Add a \"visual\" only where a real exam would show a picture; leave it null otherwise.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
