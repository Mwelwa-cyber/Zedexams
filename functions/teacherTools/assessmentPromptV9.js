/**
 * Assessment prompt — v9.
 *
 * v8 → v9: make the paper read like a real Zambian teacher's test, not a
 * topic-by-topic worksheet. v8 sectioned the paper by question TYPE and its
 * only ordering rule was a difficulty ramp, so on a multi-topic paper the
 * model emitted all of Topic 1, then all of Topic 2, … — worksheet-style
 * grouping. v9 adds four "authentic assessment" requirements, all in the
 * SYSTEM_PROMPT + user prompt:
 *   1. TOPIC INTERLEAVING — rotate topics through the paper so consecutive
 *      questions come from different topics; never cluster one topic.
 *   2. BLOOM'S MIX — vary cognitive demand (not all recall), capped at the
 *      grade's ceiling (bloomTaxonomy.bloomProfileForGrade); tag each question.
 *   3. GRADE-AWARE LANGUAGE — inject the concrete per-band language ladder
 *      (bloomTaxonomy.gradeLanguageLadder) so wording matches the grade.
 *   4. ANTI-REPETITION + SUBJECT CONVENTIONS — every question assesses
 *      something different; each subject uses its own assessment style.
 * The user prompt also injects a deterministic per-topic COVERAGE PLAN (a
 * question budget) so "distribute across topics" becomes an explicit target.
 *
 * Everything else is carried over from v8 verbatim: the chosen-types whitelist
 * as a HARD rule over the format block, MATHS NOTATION (\frac{a}{b}, $…$,
 * [[vmath …]]), the structured `visual` object, exact maths figures, original
 * comprehension passages and matching questions, and the combined-numeracy
 * rule. The schema gains two OPTIONAL per-question tags (topic + bloomLevel,
 * assessmentSchema v1.5) that this prompt asks the model to fill.
 *
 * Still grounded on the verified <curriculum_module> context block when one
 * is present. When iterating, COPY this file to v10 rather than editing v9
 * in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {ASSESSMENT_TYPE_LABELS} = require("./assessmentFormats");
const {shapeLibraryReference} = require("./assessmentShapes");
const {bloomProfileForGrade, gradeLanguageLadder} =
  require("./bloomTaxonomy");

const PROMPT_VERSION = "assessment.v9";

// Lower-primary subject keys that are an INTEGRATED Maths & Science learning
// area (the CBC "Numeracy" learning area for ECE + Grades 1-3). The maths and
// science strands share one syllabus subject, so a paper for this subject must
// deliberately cover both — see buildUserPrompt.
const COMBINED_NUMERACY_SUBJECTS = new Set(["numeracy"]);

// Human labels for the canonical question-type keys, used when listing the
// teacher's whitelist in the user prompt.
const QT_LABELS = {
  multiple_choice: "multiple choice",
  short_answer: "short answer",
  structured: "structured (multi-part)",
  calculation: "calculation (show working)",
  true_false: "true/false",
  essay: "essay / composition",
  matching: "matching (Column A with Column B)",
  fill_blanks: "fill in the blanks (structured statements with a word bank)",
};

const SYSTEM_PROMPT = `You are an expert Zambian teacher and examiner writing a formal CBC ASSESSMENT (a graded test).

Your assessment:
- Follows the Zambian paper format it is given. When an <assessment_format_context> block is provided, it is the AUTHORITATIVE paper format: reproduce its section names and headings, its instruction wording, its numbering convention and its marks distribution exactly. Scale the number of questions to the requested total marks while keeping each section's share of the marks. Match the register of its style exemplars but NEVER copy them. EXCEPTION: when the request restricts the paper to a set of allowed question types, that whitelist OVERRIDES the format — use ONLY the allowed types and never emit a section or question of any other type, even if the format block usually has one.
- Shows marks per question with a total that adds up.
- Has a complete marking scheme: the correct answer and a brief marking guide for every question (what earns the marks).
- Uses Zambian context (kwacha, local places, nshima/markets) where natural.

BALANCE — build a REAL test, not a topic-by-topic worksheet. This is the difference between a genuine Zambian assessment and a list of exercises:
- MIX THE TOPICS. When the paper covers more than one topic, ROTATE through them so that consecutive questions come from DIFFERENT topics — exactly as a real monthly/end-of-term test does. NEVER put all the questions from one topic together in a block. For example, across ten questions the topics might run: Human Body, Plants, Weather, Animals, Human Body, Soil, Plants, Living Things, Human Body, Weather — not Q1–Q4 Human Body then Q5–Q7 Plants. Follow the coverage plan in the request. Tag every question with the "topic" it assesses.
- VARY THE THINKING (Bloom's taxonomy). A good test is NOT all recall. Mix cognitive levels — remember, understand, apply, analyse (and evaluate/create where the grade allows) — following the per-grade Bloom mix in the request. Tag every question with its "bloomLevel". Order difficulty so the easier/recall questions come first, the more demanding ones later, but keep the topics interleaved throughout.
- MATCH THE GRADE'S LANGUAGE. Follow the grade-band language rules in the request exactly: vocabulary, sentence length and command words all track the learner's grade (a Grade 1 "Name two parts of the body." is worlds apart from a Grade 9 "Analyse how the circulatory and respiratory systems work together.").
- NO REPETITION. Every question must assess something DIFFERENT. Never re-ask the same fact with a different command word ("Name two bones." / "State two bones." / "Mention two bones." are the SAME question — write only one).
- SUBJECT CONVENTIONS. Assess each subject the way that subject is really tested: Science leans on diagrams, experiments, observations and scientific reasoning; Mathematics on calculations, word problems, real-life applications, measurement and geometry; English on comprehension, grammar, vocabulary and writing; Social Studies on maps, interpretation, reasoning and application. Don't use one generic template for every subject.

Comprehension passages:
- When the paper needs a reading comprehension section (the format requires one, or the teacher asks for it), write an ORIGINAL short passage (about 100-160 words for primary, longer for secondary) in that section's "passage" object — set in a Zambian or familiar African context at the grade's reading level — and make every question in that section answerable from the passage.
- NEVER copy or closely adapt a published story or textbook passage. Write fresh.
- Sections that need no passage set "passage" to null.

Matching questions:
- Use type "matching" for the classic "Match the items in Column A with Column B" exercise: 3-6 items in "left", their partners in "right" (you may add ONE extra distractor to "right"), and "pairs" where pairs[i] is the 0-based index into "right" matching left[i].
- The prompt should read like the real papers: "Match the animals in Column A with their young ones in Column B."
- Score 1 mark per correct pair unless the format says otherwise; the marking guide lists the correct pairings.

Fill-in-blanks questions:
- Use type "fill_blanks" for complete-the-sentence exercises where learners fill each blank from a provided word bank. Write 3-6 "statements", each one a separate sentence with ONE blank written as ____ (exactly four underscores). Collect every correct answer into a "wordBank" array and shuffle it; at Zambian primary-school standard, add 1-2 extra distractor words so learners must choose carefully rather than place whatever is left.
- Each statement in the "statements" array is an object: { "text": "The heart pumps ____.", "answer": "blood" }. The "answer" field is the single word (or short phrase) that fills the blank in that statement.
- ALWAYS populate the prose "answer" field at the question level with the correct answers in blank order (e.g. "blood; lungs; brain") and the "markingGuide" — the structured data may degrade on stale clients; the prose key must survive independently.
- Score 1 mark per correctly filled blank unless the format says otherwise.

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
- QUESTION TYPES: if the request gives an explicit list of allowed question types, use ONLY those types for EVERY question in the paper. This overrides the format block — do not add short-answer, structured, calculation, essay or any other type that is not on the list, even one. If the only allowed type is multiple_choice, every question is multiple_choice.
- Do NOT bake structural labels into the text: option strings carry ONLY the choice ("respiratory system", not "C. respiratory system"); section "title" carries ONLY the section name ("Multiple Choice", not "SECTION A: Multiple Choice"); and "header.instructions" carries ONLY the instruction prose ("Answer ALL questions."), never a NAME/DATE/TOTAL MARKS header — the paper draws those automatically.
- If a verified curriculum module is provided in context, assess ONLY its outcomes/content — nothing beyond it or from later lessons.
- Respect the lesson-in-a-series framing (Lesson N of M) when given.
- Age-appropriate, Zambian English spelling.
- Output a SINGLE valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

/**
 * Split the studio's joined topic string ("Human Body; Plants; Weather") back
 * into a clean, de-duplicated topic list. Accepts ";" or newline separators.
 * @param {string} topic
 * @returns {string[]}
 */
function splitTopics(topic) {
  const seen = new Set();
  const out = [];
  for (const raw of String(topic || "").split(/[;\n]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Turn the topic list into an explicit coverage plan the model must follow:
 * an even question budget across topics (unless the curriculum clearly
 * weights one more heavily) plus a worked interleaving order so the paper
 * rotates topics instead of clustering them.
 * @param {string[]} topicList (length >= 2)
 * @returns {string}
 */
function buildCoveragePlan(topicList) {
  const list = topicList.join(", ");
  // A short worked rotation over the topics (two passes) shows the model the
  // shape of an interleaved paper without pinning an exact count.
  const rotation = [];
  for (let i = 0; i < Math.min(topicList.length * 2, 10); i += 1) {
    rotation.push(`${i + 1}. ${topicList[i % topicList.length]}`);
  }
  return [
    `TOPIC COVERAGE PLAN — this paper covers ${topicList.length} topics: ${list}.`,
    "Spread the questions ROUGHLY EVENLY across all of them (give a topic a " +
      "little more only if the curriculum clearly devotes more time to it); do " +
      "NOT over-test one topic just because it has more content. Cover EVERY " +
      "topic at least once.",
    `INTERLEAVE them like this (rotate, don't cluster): ${rotation.join("  ")} …`,
  ].join(" ");
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
    totalMarks = 20,
    durationMinutes = 40,
    language = "English",
    instructions = "",
    assessmentType = "topic_test",
    questionTypes = [],
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);
  const typeLabel = ASSESSMENT_TYPE_LABELS[assessmentType] || "Topic Test";
  const allowedTypes = Array.isArray(questionTypes) ?
    questionTypes.filter((t) => QT_LABELS[t]) : [];
  const isCombinedNumeracy = COMBINED_NUMERACY_SUBJECTS
      .has(String(subject || "").toLowerCase());

  // The studio joins the teacher's chosen topics with "; " into the single
  // `topic` string. Split it back out so we can print an explicit coverage
  // plan and demand interleaving. A single topic → no plan (nothing to mix).
  const topicList = splitTopics(topic);
  const bloomProfile = bloomProfileForGrade(grade);
  const langLadder = gradeLanguageLadder(grade);

  return [
    "Write a formal Zambian CBC ASSESSMENT for the following:",
    "",
    `- Assessment type: ${typeLabel}`,
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    isCombinedNumeracy ?
      "- IMPORTANT — at this level \"Numeracy\" is the INTEGRATED Maths & " +
      "Science learning area, NOT science alone. This paper MUST cover BOTH " +
      "strands in roughly equal measure: (a) NUMBER & MATHS — counting, " +
      "number value, addition and subtraction, money, patterns, measurement, " +
      "time, and plane/solid shapes; and (b) SCIENCE & ENVIRONMENT — the " +
      "body, living/non-living things, plants and animals, materials, " +
      "weather, hygiene and surroundings. Do NOT produce a science-only (or " +
      "maths-only) paper. Pull the maths from the syllabus sub-topics in the " +
      "curriculum module (e.g. grouping things, shapes, time, addition and " +
      "subtraction) just as much as the science ones." :
      "",
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
    allowedTypes.length > 0 ?
      "- ALLOWED QUESTION TYPES — use ONLY these and NO others (this is a " +
      "hard rule that overrides the paper format; do not include a question " +
      `of any type not listed here): ${allowedTypes.map((t) => QT_LABELS[t]).join(", ")}.` :
      "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    // Grade-aware language rules (bloomTaxonomy.gradeLanguageLadder).
    `LANGUAGE LEVEL — ${langLadder.label}: ${langLadder.rules} ` +
      `Example of the right register: "${langLadder.example}"`,
    "",
    // Bloom mix appropriate to the grade band.
    `COGNITIVE MIX — vary the thinking across these Bloom levels, do NOT make ` +
      `the paper all recall. For ${grade} use: ${bloomProfile.levels.join(", ")} ` +
      `(do NOT go above "${bloomProfile.ceiling}"). Aim for at least ` +
      `${bloomProfile.minDistinct} different levels across the paper, with ` +
      `typical command words like: ${bloomProfile.verbs.join(", ")}. Put the ` +
      `easier recall questions earlier and the more demanding ones later. Tag ` +
      `each question with its "bloomLevel".`,
    "",
    // Deterministic per-topic coverage plan — turns "spread across topics"
    // into an explicit budget + an interleaving order.
    topicList.length > 1 ? buildCoveragePlan(topicList) : "",
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
    '          "type": "multiple_choice"|"short_answer"|"structured"|"calculation"|"true_false"|"essay"|"matching"|"fill_blanks",',
    '          "prompt": string,',
    '          "options": [string, ...],   // only for multiple_choice / true_false',
    '          "left": [string, ...],      // only for matching: Column A items (3-6)',
    '          "right": [string, ...],     // only for matching: Column B (may hold one extra distractor)',
    '          "pairs": [number, ...],     // only for matching: pairs[i] = 0-based index into right matching left[i]',
    '          "statements": [{"text": string, "answer": string}],  // fill_blanks only: 3-6 sentences, each with ____ blank(s)',
    '          "wordBank": [string, ...],  // fill_blanks only: all correct answers + 1-2 distractors, shuffled',
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
    '          "markingGuide": string,',
    '          "topic": string,            // the topic this question assesses (use the exact names from the coverage plan / request)',
    '          "bloomLevel": "remember"|"understand"|"apply"|"analyse"|"evaluate"|"create"  // its cognitive level',
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
    topicList.length > 1 ?
      "- INTERLEAVE the topics: consecutive questions must come from " +
      "DIFFERENT topics. Do NOT group all questions from one topic together. " +
      "Tag every question with its \"topic\" and follow the coverage plan." :
      "- Tag every question with its \"topic\".",
    "- Vary the \"bloomLevel\": the paper must not be all recall. Tag every " +
      "question with its bloomLevel and stay within the grade's cognitive mix.",
    "- Do NOT repeat a question: never re-ask one fact with a different " +
      "command word. Every question assesses something different.",
    allowedTypes.length > 0 ?
      "- Use ONLY the allowed question types listed above — every single " +
      "question must be one of them." : "",
    "- Fill-in-blanks: write each statement with ____ (4 underscores per blank); put all correct answers plus 1-2 distractors in \"wordBank\" (shuffled); set the question-level \"answer\" to the answers in blank order so stale consumers keep a marking key.",
    "- Write fractions as \\\\frac{a}{b} and other maths in $…$ — never plain ASCII like \"1/3\".",
    "- Add a \"visual\" only where a real exam would show a picture; leave it null otherwise.",
    "- Use Zambian English spelling. Return ONLY the JSON object.",
  ].filter(Boolean).join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
