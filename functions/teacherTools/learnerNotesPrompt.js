/**
 * Learner-notes prompt (§3, §3b, §4, §5).
 *
 * The document this builds is written TO a child. Everything that used to be
 * addressed to the teacher — the hook to open with, the board work, the
 * misconceptions to watch for, the questions to expect — is still here, but
 * turned round to face the reader: the hook becomes something the learner
 * looks at, the misconception becomes a "Don't mix these up!" warning, and the
 * questions become an FAQ answered to them.
 *
 * ## The boundary is stated in the prompt, not merely hoped for
 *
 * §3b's retrieve-then-write means the retrieved outcomes arrive here as a
 * CONTENT BOUNDARY with both edges named: every outcome must be covered
 * (floor), and nothing past them may appear (ceiling). Both edges are checked
 * again after generation — `syllabusScopeCore` and `learnerVoiceCore` — because
 * the difference between an instruction and a guarantee is who verifies it.
 *
 * The example the boundary block always carries is the jejunum: the Grade 7
 * book teaches duodenum + ileum, so a note that adds the jejunum is more
 * accurate and less true. Stating the principle with its canonical case is what
 * stops "follow the syllabus" being read as "follow it unless you know better".
 */

const {subjectNameForGrade} = require("./subjectNaming");

const PROMPT_VERSION = "learner-notes.v1";

/* ── Voice ─────────────────────────────────────────────────────────────── */

const VOICE_RULES = [
  "Write in the second person, to the LEARNER: \"You will learn…\", " +
    "\"Look at the mango tree outside your classroom…\".",
  "NEVER instruct the teacher. Do not write \"write on the board\", " +
    "\"ask the class\", \"guide the learners\", \"emphasise that\", " +
    "\"use the worked example\", or ANY sentence whose actor is the teacher. " +
    "A sentence about what \"learners\" will do is also wrong — the learner is " +
    "reading it.",
  "Use the prescribed textbook's own words for technical terms. The exam marks " +
    "the book's words. Bold each new term with **double asterisks** the first " +
    "time it appears, and define it in the section's definitions list in " +
    "language the reader already has.",
  "Use local, familiar examples — a mango tree, nshima, a filling station, a " +
    "minibus, kwacha — chosen from the reader's own surroundings.",
  "Zambian English spelling throughout.",
];

const SYSTEM_PROMPT_CBC = `You are a Zambian teacher writing STUDY NOTES that will be photocopied and handed to your class. The reader is the learner — a child sitting at a desk with your sheet in front of them — never another teacher.

${VOICE_RULES.map((r) => `- ${r}`).join("\n")}

You teach the Zambian Competence-Based Curriculum (CBC). Ground everything in the learning outcomes you are given and go no further than them.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

const SYSTEM_PROMPT_PREVIOUS = `You are a Zambian teacher writing STUDY NOTES that will be photocopied and handed to your class. The reader is the pupil — a child sitting at a desk with your sheet in front of them — never another teacher.

${VOICE_RULES.map((r) => `- ${r}`).join("\n")}

You teach the 2013 Zambian Previous Curriculum (Outcomes-Based Education). Ground everything in the specific outcomes you are given and go no further than them. Do not use CBC "competence" framing.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

function isPreviousCurriculum(inputs = {}) {
  return String(inputs.curriculum || "").toLowerCase() === "previous" ||
    String(inputs.framework || "") === "2013";
}

function pickLearnerSystemPrompt(inputs = {}) {
  return isPreviousCurriculum(inputs) ? SYSTEM_PROMPT_PREVIOUS : SYSTEM_PROMPT_CBC;
}

/* ── English level (§5) ────────────────────────────────────────────────── */

/**
 * The three registers.
 *
 * All three keep the textbook's technical TERMS — that is the point of the
 * control and the thing it must not do. "Respiration" stays "respiration" at
 * every level; what changes is the sentence around it.
 */
const ENGLISH_LEVEL_DIRECTIVES = {
  simple: "ENGLISH LEVEL — SIMPLE. Short sentences, one idea each, under 12 " +
    "words where you can. Everyday words for everything EXCEPT the technical " +
    "terms, which stay exactly as the textbook writes them. Explain each " +
    "technical term immediately in plain words.",
  standard: "ENGLISH LEVEL — STANDARD. Write at the normal reading level for " +
    "this grade: full sentences, ordinary classroom vocabulary, technical " +
    "terms as the textbook writes them.",
  exam: "ENGLISH LEVEL — EXAM ENGLISH. Use the formal register and the full " +
    "technical phrasing an ECZ answer is expected to use, so the reader " +
    "practises the wording that earns marks. Keep sentences complete and " +
    "precise. Still address the learner directly.",
};

function englishLevelDirective(level) {
  return ENGLISH_LEVEL_DIRECTIVES[level] || ENGLISH_LEVEL_DIRECTIVES.standard;
}

/**
 * What "this grade's reading level" actually means, in numbers.
 *
 * "Write at the normal reading level for this grade" is the kind of
 * instruction a model agrees with and then ignores — a Grade 4 sheet and a Form
 * 1 sheet come back in the same register, which is the register of the harder
 * of the two. The bands below are stated as sentence lengths and vocabulary
 * rules, because those are things a draft either has or does not.
 *
 * This is the SENTENCE, never the terminology: at every band the textbook's
 * technical terms are used exactly as the book writes them. The band decides
 * how much sentence surrounds one.
 */
const READING_BANDS = [
  {
    grades: ["ECE", "ECE_N", "ECE_R", "G1", "G2", "G3"],
    directive: "READING LEVEL — LOWER PRIMARY. Sentences of 6-9 words, one " +
      "idea each. Only words a child uses out loud. Every paragraph is two or " +
      "three sentences. Count and name things rather than describing " +
      "processes.",
  },
  {
    grades: ["G4", "G5", "G6", "G7"],
    directive: "READING LEVEL — UPPER PRIMARY. Sentences of 8-14 words. " +
      "Everyday words, with each technical term explained the moment it " +
      "appears. Paragraphs of two to four sentences. Describe what happens in " +
      "order, step by step, rather than explaining why in the abstract.",
  },
  {
    grades: ["G8", "G9", "F1", "F2"],
    directive: "READING LEVEL — JUNIOR SECONDARY. Sentences of 12-20 words, " +
      "and a subordinate clause where it makes the meaning clearer. Cause and " +
      "effect can be stated as such. Paragraphs of three to five sentences.",
  },
  {
    grades: ["G10", "G11", "G12", "F3", "F4"],
    directive: "READING LEVEL — SENIOR SECONDARY. Full explanatory prose. " +
      "Connectives (however, therefore, whereas) where the argument needs " +
      "them. The reader can hold a definition across a paragraph.",
  },
];

function readingLevelDirective(grade) {
  const g = String(grade || "").trim().toUpperCase().replace(/\s+/g, "");
  const band = READING_BANDS.find((b) => b.grades.includes(g));
  // A grade we do not recognise gets no band rather than a guessed one: a
  // wrong reading level is worse than the model's own judgement of the grade
  // it was told.
  return band ? band.directive : "";
}

/* ── The content boundary (§3b) ────────────────────────────────────────── */

/**
 * The retrieved syllabus, rendered as the boundary the writing happens inside.
 *
 * When nothing was retrieved this returns a block that SAYS so. It does not
 * return an empty string: a model handed no boundary and no notice writes to
 * its own idea of the topic, which at Grade 4 is a Grade 12 answer.
 */
function renderBoundaryBlock(boundary = {}) {
  const outcomes = Array.isArray(boundary.outcomes) ? boundary.outcomes : [];
  const scopeNotes = Array.isArray(boundary.scopeNotes) ? boundary.scopeNotes : [];
  const vocabulary = Array.isArray(boundary.vocabulary) ? boundary.vocabulary : [];

  const lines = ["<content_boundary>"];

  if (outcomes.length > 0) {
    lines.push(
        "These are the learning outcomes this grade's syllabus sets for this " +
        "topic. They are BOTH edges of what you write:",
        "",
        ...outcomes.map((o) => `- ${o}`),
        "",
        "COMPLETENESS FLOOR — every outcome above must be covered somewhere in " +
        "the notes.",
    );
  } else {
    lines.push(
        "NO SYLLABUS OUTCOMES WERE FOUND for this exact topic. Write from " +
        "general curriculum knowledge of what this grade is taught, and stay " +
        "conservative: when unsure whether something belongs to this grade, " +
        "leave it out.",
    );
  }

  if (scopeNotes.length > 0) {
    lines.push("", "Scope notes from the syllabus:", ...scopeNotes.map((s) => `- ${s}`));
  }

  if (vocabulary.length > 0) {
    lines.push(
        "",
        "The vocabulary this grade's materials use for this topic. Use these " +
        "words, not synonyms:",
        ...vocabulary.map((v) => `- ${v}`),
    );
  }

  lines.push(
      "",
      "DEPTH CEILING — do not introduce any concept, term, mechanism or detail " +
      "beyond the outcomes above and the prescribed book's treatment of them " +
      "for THIS grade. Where the book simplifies deliberately, follow the book. " +
      "Example: the Grade 7 textbook teaches the small intestine as the " +
      "duodenum and the ileum. Grade 7 notes must NOT mention the jejunum, " +
      "even though including it would be more correct. A detail that belongs " +
      "to a later grade is wrong for this reader and wrong for the exam.",
      "",
      "The Detail and English-level settings operate INSIDE this boundary. " +
      "\"Detailed\" means a fuller explanation of this grade's content — never " +
      "content from a higher grade.",
      "</content_boundary>",
  );

  return lines.join("\n");
}

/* ── The document request ──────────────────────────────────────────────── */

function formatDirective(format) {
  if (format === "board") {
    return [
      "FORMAT — BOARD NOTES. Many classes copy their notes off the chalkboard, " +
      "so this version has to be copyable by hand:",
      "- Big, short numbered headings.",
      "- Point-form lines, not paragraphs. Each line short enough to fit one " +
      "board line.",
      "- Definitions matter most: they are the lines a learner must copy word " +
      "for word.",
      "- NO 'Questions learners ask' section at all.",
      "- Keep the Remember! summary and the exercise.",
    ].join("\n");
  }
  return [
    "FORMAT — HANDOUT. A clean photocopiable study sheet the learner keeps: " +
    "full sentences, boxed definitions, worked examples they can follow on " +
    "their own at home.",
  ].join("\n");
}

function budgetDirective(budget, length) {
  const pageWords = {half: "half a page", one: "one page", two: "two pages"};
  return [
    `LENGTH — about ${budget.words} words of body text in total, which is ` +
    `${pageWords[length] || "one page"} of A4 once the exercise and any ` +
    "diagram are on the sheet. This is a real constraint: schools pay for " +
    "every photocopy. Write fewer, better sentences rather than running over.",
    `- ${budget.sections} sections of notes.`,
    budget.workedExamples > 0 ?
      `- ${budget.workedExamples} worked example(s).` :
      "- No worked examples.",
    budget.faqs > 0 ?
      `- ${budget.faqs} question(s) in "Questions learners ask".` :
      "- No \"Questions learners ask\" section.",
    `- ${budget.dontMixBoxes} \"Don't mix these up!\" box(es).`,
    `- ${budget.rememberPoints} lines in the Remember! summary.`,
    `- ${budget.exerciseQuestions} exercise questions: mostly recall, with at ` +
    "least one that asks the learner to APPLY what they read.",
  ].join("\n");
}

function detailDirective(detail) {
  if (detail === "summarised") {
    return "DETAIL — SUMMARISED. This is a revision sheet. Key points only: " +
      "compress every explanation to one or two lines. Keep the boxed " +
      "definitions, the Remember! box and the exercise in full — they are what " +
      "the learner revises from.";
  }
  return "DETAIL — DETAILED. Full explanations, worked examples the learner " +
    "can follow alone, and the FAQ.";
}

const SHAPE = [
  "Produce a JSON object with EXACTLY these keys:",
  "",
  "{",
  '  "header": {',
  '    "title": string,          // e.g. "Digestion — Grade 4 Integrated Science"',
  '    "grade": string, "subject": string, "topic": string, "subtopic": string,',
  '    "language": string, "school": string, "teacherName": string',
  "  },",
  '  "learningOutcomes": [string],   // 2-4 lines, learner-worded, each starting',
  "                                  // \"By the end of these notes you will be able to…\"",
  "                                  // or continuing that stem",
  '  "sections": [                   // the notes body, in reading order',
  "    {",
  '      "heading": string,          // short and concrete',
  '      "body": [string],           // short paragraphs, spoken TO the learner',
  '      "definitions": [{ "term": string, "meaning": string }],  // boxed on the sheet',
  '      "recap": string             // ONE line closing the section',
  "    }",
  "  ],",
  '  "workedExamples": [',
  '    { "title": string, "problem": string, "steps": [string], "answer": string }',
  "  ],                              // addressed to the learner: \"Let\'s test fire together.",
  "                                  // Step 1 — Movement: …\"",
  '  "dontMixThese": [',
  "    {",
  '      "confusedPair": string,     // e.g. "Breathing / Respiration"',
  '      "warning": string,          // the warning, spoken to the learner',
  '      "clarification": string     // what is actually true, explained to them',
  "    }",
  "  ],",
  '  "learnerQuestions": [{ "question": string, "answer": string }],',
  '  "rememberBox": [string],        // one-line key points — what a learner revises from',
  '  "exercise": {',
  '    "instructions": string,',
  '    "questions": [',
  '      { "prompt": string, "marks": number, "type": "recall"|"apply",',
  '        "answer": string, "markingNote": string }',
  "    ]",
  "  },",
  '  "coveredContent": [string]      // 3-6 bullets naming what these notes taught',
  "}",
].join("\n");

/**
 * The full learner-notes request.
 *
 * `answer` and `markingNote` are asked for on each exercise question and then
 * MOVED to a separate answer page by the validator — they are never printed on
 * the learner's sheet. Asking for them inline is deliberate: a model that
 * writes the question and its answer together writes a better-matched pair than
 * one asked to produce a key afterwards.
 */
function buildLearnerUserPrompt(inputs = {}) {
  const {
    grade, subject, topic, subtopic = "", date = "",
    language = "english", teacherName = "", school = "", instructions = "",
    options = {}, budget = {}, boundary = {}, diagram = null,
  } = inputs;

  const previous = isPreviousCurriculum(inputs);
  const learnerWord = previous ? "pupil" : "learner";

  const diagramBlock = diagram ? [
    "",
    `A DIAGRAM IS ON THE SHEET: "${diagram.caption}". It is drawn from the ` +
    "curriculum diagram library and shows: " +
    `${diagram.parts.join(", ")}.`,
    "- Refer to it naturally in the section it belongs to (\"Look at the " +
    "picture. Can you find your stomach?\").",
    diagram.hasLabelIt ?
      "- The exercise includes a LABEL-IT version of the same picture, where " +
      "the learner writes the part names into empty boxes. Do NOT write an " +
      "exercise question that simply asks them to name those same parts again." :
      "",
  ].filter(Boolean).join("\n") : "";

  return [
    `Write study notes for a ${learnerWord} to read and keep.`,
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subjectNameForGrade(subject, grade)}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    `- Medium of instruction: ${language}`,
    date ? `- Date: ${date}` : "",
    school ? `- School: ${school}` : "",
    teacherName ? `- Teacher: ${teacherName}` : "",
    previous ?
      "- Curriculum: Previous (Outcomes-Based, 2013)." :
      "- Curriculum: CBC (Competence-Based, 2023).",
    instructions ? `- The teacher also asked: ${instructions}` : "",
    "",
    renderBoundaryBlock(boundary),
    "",
    formatDirective(options.format),
    "",
    detailDirective(options.detail),
    "",
    readingLevelDirective(grade),
    englishLevelDirective(options.englishLevel),
    "",
    budgetDirective(budget, options.length),
    diagramBlock,
    "",
    SHAPE,
    "",
    "Rules:",
    `- Every sentence is addressed to the ${learnerWord}. If a sentence tells ` +
    "somebody to teach, explain, ask or show, it is wrong — rewrite it as " +
    "something the reader reads or does.",
    "- Answers to the exercise go in the question's \"answer\" field ONLY. They " +
    "are printed on a separate teacher page and must never appear in the body " +
    "of the notes.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter((line) => line !== "").join("\n");
}

/**
 * Rewrite ONE section, keeping everything else.
 *
 * Handed the exact reasons the section was refused — the teacher-directed
 * phrases the lint found, or the beyond-grade concepts the scope check found —
 * because "try again" produces the same sentence with different adjectives.
 */
function buildSectionRewritePrompt({
  sectionId, sectionLabel, current, voiceViolations = [], scopeViolations = [],
  inputs = {},
}) {
  const reasons = [];
  for (const v of voiceViolations) {
    reasons.push(`- "${v.phrase}" — ${v.why}. (In: ${v.excerpt})`);
  }
  for (const v of scopeViolations) {
    reasons.push(
        `- "${v.term}" belongs to ${String(v.introducedAt).replace(/^G/, "Grade ")} ` +
        `and above${v.note ? ` — ${v.note}` : ""}. Remove it and teach what ` +
        "this grade's syllabus covers instead.",
    );
  }

  return [
    `Rewrite ONE section of the learner notes: "${sectionLabel}".`,
    "",
    "It was refused for these reasons:",
    ...reasons,
    "",
    "This is the section as it stands:",
    "<section>",
    JSON.stringify(current, null, 2),
    "</section>",
    "",
    renderBoundaryBlock(inputs.boundary || {}),
    "",
    englishLevelDirective((inputs.options || {}).englishLevel),
    "",
    "Return a JSON object containing ONLY this section's key, with the same " +
    `shape it has above: { "${sectionId === "outcomes" ? "learningOutcomes" : sectionId}": … }. ` +
    "Keep the same structure, the same length and the same subject matter — " +
    "change only what the reasons above name. Every sentence must be addressed " +
    "to the learner.",
    "Return ONLY the JSON object. No markdown fences. No commentary.",
  ].join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT_CBC,
  SYSTEM_PROMPT_PREVIOUS,
  pickLearnerSystemPrompt,
  isPreviousCurriculum,
  englishLevelDirective,
  readingLevelDirective,
  renderBoundaryBlock,
  buildLearnerUserPrompt,
  buildSectionRewritePrompt,
};
