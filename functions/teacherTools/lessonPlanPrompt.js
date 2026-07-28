/**
 * Lesson Plan Generator prompt — v3.
 *
 * Rebuilt 2026-06 against the SAMPLE LESSON PLAN appendices of the official
 * 2023-curriculum CDC teaching modules (ECE CTS, Grade 2 CTS, Grade 4
 * Science / Social Studies / HEH / Maths / English / Technology Studies,
 * English ECE, Form 2 Literature). All ten samples share ONE canonical
 * structure, which this prompt reproduces:
 *
 *   header → GENERAL COMPETENCES → SPECIFIC COMPETENCE → LESSON
 *   GOAL → RATIONALE (content/value/method/position) → PRIOR KNOWLEDGE →
 *   REFERENCES → LEARNING ENVIRONMENT (Natural/Artificial/Technological) →
 *   TEACHING AND LEARNING MATERIALS → EXPECTED STANDARD → LESSON
 *   PROGRESSION [Stages | Teacher's Activities | Learners' Activities |
 *   Assessment Criteria] with INTRODUCTION → LESSON DEVELOPMENT →
 *   EXERCISE/ASSESSMENT → HOMEWORK → CONCLUSION → LESSON EVALUATION
 *   (left blank for the teacher).
 *
 * v2 (5E Engagement/Exploration/Explanation/Synthesis/Evaluation) was
 * retired because no official module uses those stage names. Older
 * aiGenerations documents record the prompt version used so historical
 * outputs remain reproducible.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");
const {schoolResourcePromptLines} = require("./schoolResources");

const PROMPT_VERSION = "lesson_plan.v3";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and CDC (Curriculum Development Centre) curriculum specialist. You write Competence-Based Curriculum (CBC) lesson plans that match the SAMPLE LESSON PLAN appendix of the official CDC teaching modules exactly as a Zambian head teacher or School Inspector would expect to see them.

CBC focuses on developing competences (what learners can DO) rather than just knowledge (what they know). Every section of your plan must contribute to competence development.

Your lesson plans MUST follow the official module structure:
- GENERAL COMPETENCES — 3-5 from: Communication, Collaboration, Critical Thinking, Analytical Thinking, Creativity and Innovation, Problem Solving, Citizenship, Emotional Intelligence, Digital Literacy, Entrepreneurship, Environmental Sustainability.
- SPECIFIC COMPETENCE — the syllabus specific competence written out in full, e.g. "Manage natural resources and waste in the environment". Do NOT prefix it with a syllabus code (no "4.3.1.1").
- LESSON GOAL — one SMART sentence using action verbs (identify, describe, demonstrate, practise) — never "know" or "understand".
- RATIONALE — one paragraph covering WHAT the lesson focuses on, the VALUE to learners' lives, the METHODS/strategies used, and its POSITION, ending "This is lesson K in a series of N."
- PRIOR KNOWLEDGE, REFERENCES (syllabus page + teaching module page), LEARNING ENVIRONMENT (Natural / Artificial / Technological — one line each), TEACHING AND LEARNING MATERIALS with local alternatives.
- EXPECTED STANDARD — passive voice, lifted from the syllabus standard, e.g. "Natural resources and waste in the environment managed correctly."
- LESSON PROGRESSION with EXACTLY these stages in order: INTRODUCTION → LESSON DEVELOPMENT → EXERCISE / ASSESSMENT → HOMEWORK → CONCLUSION. LESSON DEVELOPMENT may be split into 2-3 consecutive entries named "LESSON DEVELOPMENT — Activity 1: <short title>" etc. when the lesson naturally has distinct timed activities (as official Mathematics and Science modules do). Do NOT invent other stage names — never use Engagement/Exploration/Explanation/Synthesis as stage names.
- Each stage has Teacher's Activities, Learners' Activities AND Assessment Criteria (observable learner behaviour). Stage durations MUST sum to the requested lesson duration (within 2 minutes).
- INTRODUCTION starts with a hook (question, scenario, song, picture, quick review). EXERCISE / ASSESSMENT produces evidence (written exercise, demonstration, presentation). HOMEWORK is one short task often involving family or the local community. CONCLUSION guides learners to bring out the main points themselves.
- Inside LESSON DEVELOPMENT let learners explore and discover BEFORE the teacher consolidates with formal explanation.
- Be concrete, not abstract — every activity is something a teacher could actually do tomorrow morning in a real Zambian classroom.
- Respect the school's resources. Unless the prompt says the school is well-resourced, assume a typical Zambian classroom with NO projector, computers, photocopier or reliable electricity: build activities around the chalkboard and materials a teacher can gather for free locally (stones, sticks, bottle tops, seeds, sand, clay, hand-made paper aids), and whenever you name a bought or powered item, give a free local alternative in the same line.
- Be culturally grounded in Zambia: use Zambian examples (Kwacha, nshima, Lusaka/Kitwe/Ndola, local markets) where natural, never where forced.
- Ground content in the <cbc_context> block provided. Do not invent topics, outcomes, or competences inconsistent with it.

PROFESSIONAL WRITING STANDARDS — this document is inspected by head teachers and standards officers, so the writing must be flawless:
- Complete, grammatically correct sentences ending with a full stop. No fragments, no trailing "..." and no double spaces.
- Teacher activities are imperative and start with a strong verb ("Ask learners...", "Demonstrate...", "Guide learners to..."). Learner activities are present-tense responses ("Share their experiences...", "Discuss...", "Draw...").
- Keep tense, person and voice consistent within each list. Never mix "pupils" and "learners" — use "learners" throughout.
- Number multi-step tasks consistently; every list item is parallel in structure to its siblings.
- No contractions (write "do not", not "don't"), no slang, no first person ("I/we"), no placeholder text like "N/A" or "TBD".
- Capitalise proper nouns correctly (Zambia, Lusaka, Kwacha) and use subject-correct terminology from the syllabus.
- Include expected answers in brackets where natural, e.g. (Expected answers: soil, water, grass).
- Use Zambian English spelling (colour, practise as verb, programme). Plain-text fractions like "1/2" — never unicode glyphs like ½. No markdown.`;

/**
 * @param {object} inputs
 *   // Existing fields:
 *   grade, subject, topic, subtopic, term, lessonNumber, totalLessons,
 *   learningEnvironment, durationMinutes, language, teacherName, school,
 *   numberOfPupils, boysPresent, girlsPresent, instructions,
 *   resourceLevel: 'low' | 'basic' | 'full' | ''  (school equipment level;
 *     '' omits the block and the system prompt's low-resource default applies)
 *   // New fields:
 *   curriculumMode: 'cbc' | 'previous' | null  (default 'cbc')
 *   specificCompetence: string   (CBC only — from SPECIFIC COMPETENCES column)
 *   learningActivities: string[] (CBC only — parsed from LEARNING ACTIVITIES)
 *   expectedStandard: string     (CBC only — from EXPECTED STANDARD column)
 *   selectedOutcomes: string[]   (Previous only — the selected specific outcomes)
 *   coveredActivities: string[]  (optional — content covered in earlier lessons, to avoid repetition)
 *   lessonFocus: string          (optional — the specific focus for this lesson in a series)
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
    durationMinutes = 40,
    language = "English",
    teacherName = "",
    school = "",
    numberOfPupils = 40,
    boysPresent = null,
    girlsPresent = null,
    instructions = "",
    resourceLevel = "",
    curriculumMode = "cbc",
    specificCompetence = "",
    learningActivities = [],
    expectedStandard = "",
    selectedOutcomes = [],
    coveredActivities = [],
    lessonFocus = "",
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);
  const isPrevious = curriculumMode === "previous";

  const openingLine = isPrevious
    ? "Generate a Zambian lesson plan (Previous Curriculum / Outcomes-Based) for the following lesson:"
    : "Generate a Zambian CBC lesson plan for the following lesson:";

  const lines = [
    openingLine,
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This is Lesson ${lessonNumber} of ${totalLessons} for this ` +
      "sub-topic. Teach only this lesson's share of the sub-topic; build " +
      "on Lessons 1.." + (lessonNumber - 1) + " without repeating them, " +
      "and do not pre-empt later lessons." :
      lessonNumber ?
        `- This is Lesson ${lessonNumber} for this sub-topic. Teach only ` +
        "this lesson's portion; build on earlier lessons without repeating " +
        "them and do not pre-empt later ones." : "",
    leLabel ? `- Learning environment: ${leLabel}` : "",
    ...schoolResourcePromptLines(resourceLevel),
    `- Lesson duration: ${durationMinutes} minutes`,
    `- Medium of instruction: ${language}`,
    `- Estimated number of pupils: ${numberOfPupils}`,
    boysPresent != null ? `- Boys present: ${boysPresent}` : "",
    girlsPresent != null ? `- Girls present: ${girlsPresent}` : "",
    teacherName ? `- Teacher name: ${teacherName}` : "",
    school ? `- School: ${school}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
  ];

  // ── CBC context block ──────────────────────────────────────────────────────
  if (!isPrevious) {
    if (specificCompetence || learningActivities.length || expectedStandard) {
      lines.push(
        "",
        "<cbc_context>",
        specificCompetence ? `Specific Competence: ${specificCompetence}` : "",
        learningActivities.length
          ? `Learning Activities (from syllabus): ${learningActivities.join(" | ")}`
          : "",
        expectedStandard ? `Expected Standard: ${expectedStandard}` : "",
        "</cbc_context>",
        "",
        "Ground the entire plan in this context. The specificCompetence drives every stage.",
      );
    }
  }

  // ── Covered activities + lesson focus (applies to both CBC and Previous) ──
  if (coveredActivities.length) {
    lines.push(
      `Previously covered in this series (DO NOT repeat): ${coveredActivities.join(" | ")}`,
      `Focus for THIS lesson: ${lessonFocus || "Continue from covered content above"}`,
    );
  }

  // ── Previous Curriculum context block ─────────────────────────────────────
  if (isPrevious && selectedOutcomes.length) {
    lines.push(
      "",
      "<previous_context>",
      "Specific Outcome(s) for this lesson:",
      ...selectedOutcomes.map((o, i) => `${i + 1}. ${o}`),
      "</previous_context>",
      "",
      "Ground the lesson in achieving these specific outcomes. The lesson structure " +
      "follows the standard Zambian Previous Curriculum format: Introduction → " +
      "Development → Conclusion → Homework. Every stage must contribute to learners " +
      "achieving the stated outcomes.",
    );
  }

  lines.push(
    "",
    "Produce the lesson plan as a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "school": string, "teacherName": string, "date": string (YYYY-MM-DD, today if unknown),',
    '    "time": string, "durationMinutes": number, "class": string, "subject": string,',
    '    "topic": string,     // the topic name only, with NO syllabus code, e.g. "The Environment" (not "4.3 The Environment")',
    '    "subtopic": string,  // the sub-topic name only, with NO syllabus code, e.g. "Environmental Management" (not "4.3.1 Environmental Management")',
    '    "termAndWeek": string,',
    '    "boysPresent": number, "girlsPresent": number, "totalPupils": number,',
    '    "mediumOfInstruction": string',
    "  },",
    '  "generalCompetences": [string, ...],  // 3-5 from the CBC framework list',
    isPrevious
      ? '  "specificOutcome": string,           // the stated specific outcome(s) for this lesson'
      : '  "specificCompetence": string,         // written out, with NO syllabus code, e.g. "Practise safe and hygienic ways of handling food"',
    '  "lessonGoal": string,                 // ONE SMART sentence',
    '  "rationale": string,                  // content + value + methods + position, ending "This is lesson K in a series of N."',
    '  "priorKnowledge": string,             // what learners already know related to this lesson',
    '  "references": [string, ...],          // 2-3 entries: subject syllabus with page, grade Teaching Module with page, optionally a textbook',
    '  "learningEnvironment": { "natural": string, "artificial": string, "technological": string },  // one line each; "" if genuinely not used',
    '  "materials": [string, ...],           // 3-6 specific teaching/learning materials with local alternatives',
    '  "expectedStandard": string,           // PASSIVE voice from the syllabus, e.g. "Road safety practised correctly."',
    '  "stages": [',
    isPrevious
      ? [
        '    { "name": "INTRODUCTION",  "durationMinutes": n, "teacherActivities": [string,...], "learnerActivities": [string,...], "assessmentCriteria": [string,...] },',
        '    { "name": "DEVELOPMENT",   "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
        '    { "name": "CONCLUSION",    "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
        '    { "name": "HOMEWORK",      "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] }',
      ].join("\n")
      : [
        '    { "name": "INTRODUCTION",          "durationMinutes": n, "teacherActivities": [string,...], "learnerActivities": [string,...], "assessmentCriteria": [string,...] },',
        '    { "name": "LESSON DEVELOPMENT",    "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
        '    { "name": "EXERCISE / ASSESSMENT", "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
        '    { "name": "HOMEWORK",              "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
        '    { "name": "CONCLUSION",            "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] }',
      ].join("\n"),
    "  ],",
    '  "remedialWork": string,        // short support task for learners who struggled ("" if not needed)',
    '  "extensionActivity": string,   // short stretch task for fast finishers ("" if not needed)',
    '  "coveredContent": [string, ...]  // 3-6 short bullets naming exactly what THIS lesson teaches, so later lessons of the sub-topic don\'t repeat it',
    "}",
    "",
    "Rules:",
    isPrevious
      ? "- For Previous Curriculum, the lesson MUST target the stated Specific Outcomes. Replace \"specificCompetence\" with \"specificOutcome\" in the JSON."
      : "- Exactly the five official stages, in that order. LESSON DEVELOPMENT may be split into 2-3 consecutive entries named \"LESSON DEVELOPMENT — Activity 1: <short title>\" when the lesson naturally has distinct timed activities.",
    isPrevious
      ? "- Stage names for Previous Curriculum: INTRODUCTION → DEVELOPMENT → CONCLUSION → HOMEWORK (4 stages, not 5)."
      : "",
    "- Stage durations must sum to within 2 minutes of the requested lesson duration.",
    "- For each stage, teacherActivities and learnerActivities must be PARALLEL (every teacher move has a matching learner response), and assessmentCriteria must describe observable learner behaviour.",
    "- lessonGoal MUST pass the SMART test on its own, without reading the rest of the plan.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  );

  return lines.filter(Boolean).join("\n");
}


const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");
const {SCHOOL_RESOURCE_VALUES} = require("./schoolResources");

// The allow-lists the legacy sanitiser validates against. They moved here with
// sanitizeInputs, for the same reason: this is the module that still consumes
// the shape they describe.
const ALLOWED_GRADES = new Set([
  "ECE", "ECE_N", "ECE_R", "G1", "G2", "G3", "G4", "G5", "G6", "G7",
  "G8", "G9", "G10", "G11", "G12",
]);
// Mirrors the frontend TEACHER_SUBJECTS list in src/utils/teacherTools.js.
// Every subject the dropdown can select must be accepted here, otherwise the
// frontend silently fails with "Please select a supported subject."
const ALLOWED_SUBJECTS = new Set([
  "mathematics", "numeracy", "english", "literacy",
  "cinyanja", "zambian_language",
  "integrated_science", "environmental_science",
  "biology", "chemistry", "physics",
  "social_studies", "history", "geography", "civic_education",
  "religious_education",
  "technology_studies", "creative_and_technology_studies",
  "home_economics", "expressive_arts", "physical_education",
  // CBC 2023 Forms 1-4 subjects the Syllabus Studio exposes as their own
  // canonical keys (Agricultural Science and Art & Design are shared with
  // the 2013 syllabus).
  "agricultural_science", "art_and_design",
  "commerce_and_principles_of_accounts",
  "design_and_technology_studies", "music_and_creative_arts",
  // ── The 2026-07 subject split ──────────────────────────────────────────
  // Canonical keys carved out of shared ones, each its own examinable subject
  // with its own numbering (see src/utils/subjectSplitClassifier.js). The
  // pre-split spellings above are kept so a saved pick still passes.
  "commerce", "principles_of_accounts",
  "food_and_nutrition", "fashion_and_fabrics", "mathematics_ii",
  "literature_in_english",
  // The 2013 senior RE split: two separately examined ECZ syllabi.
  "religious_education_2044", "religious_education_2046",
  // Not previously listed here, so this generator rejected the pick outright.
  "hospitality_management",
]);
const ALLOWED_LANGUAGES = new Set([
  "english", "bemba", "nyanja", "tonga", "lozi", "kaonde", "lunda", "luvale",
]);
const LE_VALUES = new Set(LEARNING_ENVIRONMENT_VALUES);
const RESOURCE_VALUES = new Set(SCHOOL_RESOURCE_VALUES);

/**
 * Sanitise a legacy lesson-plan input payload.
 *
 * It used to live in generateLessonPlan.js. That file became a thin adapter
 * onto the one lesson-plan operation, which sanitises through the TYPED
 * request instead — but this prompt module is still live (reviseLessonSection
 * builds its user prompt here), and its own test needs a sanitiser for the
 * shape this prompt actually takes. So it moved here, beside the prompt it
 * serves, rather than being stranded in an adapter that no longer uses it.
 */
function sanitizeInputs(raw = {}) {
  const str = (v, max) => (typeof v === "string" ?
    v.replace(/\u0000/g, "").trim().slice(0, max) : "");
  const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

  const grade = str(raw.grade, 10).toUpperCase().replace(/\s+/g, "");
  const subject = str(raw.subject, 40).toLowerCase().replace(/[^a-z_]/g, "_");
  const language = str(raw.language || "english", 20).toLowerCase();

  // Optional curriculum-module selectors. Absent/0 → null so resolveCbcContext
  // and the prompt behave exactly as before this upgrade.
  const term = Math.round(num(raw.term, 0));
  const lessonNumber = Math.round(num(raw.lessonNumber, 0));
  const totalLessons = Math.round(num(raw.totalLessons, 0));
  const learningEnvironment = str(raw.learningEnvironment, 40)
    .toLowerCase().replace(/[^a-z_]/g, "_");
  const resourceLevel = str(raw.resourceLevel, 10).toLowerCase();

  const curriculumMode = ["cbc", "previous"].includes(raw.curriculumMode) ?
    raw.curriculumMode : "cbc";
  const specificCompetence = str(raw.specificCompetence, 300);
  const learningActivities = Array.isArray(raw.learningActivities) ?
    raw.learningActivities.map((a) => str(a, 200)).filter(Boolean) : [];
  const expectedStandard = str(raw.expectedStandard, 300);
  const selectedOutcomes = Array.isArray(raw.selectedOutcomes) ?
    raw.selectedOutcomes.map((o) => str(o, 300)).filter(Boolean) : [];
  const coveredActivities = Array.isArray(raw.coveredActivities) ?
    raw.coveredActivities.map((a) => str(a, 200)).filter(Boolean) : [];
  const lessonFocus = str(raw.lessonFocus, 200);

  return {
    grade,
    subject,
    topic: str(raw.topic, 120),
    subtopic: str(raw.subtopic, 160),
    term: term >= 1 && term <= 3 ? term : null,
    lessonNumber: lessonNumber >= 1 ? lessonNumber : null,
    totalLessons: totalLessons >= 1 ? totalLessons : null,
    learningEnvironment: LE_VALUES.has(learningEnvironment) ?
      learningEnvironment : "",
    resourceLevel: RESOURCE_VALUES.has(resourceLevel) ? resourceLevel : "",
    durationMinutes: Math.min(120, Math.max(20, Math.round(num(raw.durationMinutes, 40)))),
    language: ALLOWED_LANGUAGES.has(language) ? language : "english",
    teacherName: str(raw.teacherName, 80),
    school: str(raw.school, 120),
    numberOfPupils: Math.min(200, Math.max(1, Math.round(num(raw.numberOfPupils, 40)))),
    instructions: str(raw.instructions, 500),
    curriculumMode,
    specificCompetence,
    learningActivities,
    expectedStandard,
    selectedOutcomes,
    coveredActivities,
    lessonFocus,
  };
}

module.exports = {
  sanitizeInputs,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
