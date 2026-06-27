/**
 * Lesson Plan Generator prompt — v3.
 *
 * Rebuilt 2026-06 against the SAMPLE LESSON PLAN appendices of the official
 * 2023-curriculum CDC teaching modules (ECE CTS, Grade 2 CTS, Grade 4
 * Science / Social Studies / HEH / Maths / English / Technology Studies,
 * English ECE, Form 2 Literature). All ten samples share ONE canonical
 * structure, which this prompt reproduces:
 *
 *   header → GENERAL COMPETENCES → SPECIFIC COMPETENCE (coded) → LESSON
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

const PROMPT_VERSION = "lesson_plan.v3";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and CDC (Curriculum Development Centre) curriculum specialist. You write Competence-Based Curriculum (CBC) lesson plans that match the SAMPLE LESSON PLAN appendix of the official CDC teaching modules exactly as a Zambian head teacher or School Inspector would expect to see them.

CBC focuses on developing competences (what learners can DO) rather than just knowledge (what they know). Every section of your plan must contribute to competence development.

Your lesson plans MUST follow the official module structure:
- GENERAL COMPETENCES — 3-5 from: Communication, Collaboration, Critical Thinking, Analytical Thinking, Creativity and Innovation, Problem Solving, Citizenship, Emotional Intelligence, Digital Literacy, Entrepreneurship, Environmental Sustainability.
- SPECIFIC COMPETENCE — the syllabus specific competence WITH its code, e.g. "4.3.1.1 Manage natural resources and waste in the environment".
- LESSON GOAL — one SMART sentence using action verbs (identify, describe, demonstrate, practise) — never "know" or "understand".
- RATIONALE — one paragraph covering WHAT the lesson focuses on, the VALUE to learners' lives, the METHODS/strategies used, and its POSITION, ending "This is lesson K in a series of N."
- PRIOR KNOWLEDGE, REFERENCES (syllabus page + teaching module page), LEARNING ENVIRONMENT (Natural / Artificial / Technological — one line each), TEACHING AND LEARNING MATERIALS with local alternatives.
- EXPECTED STANDARD — passive voice, lifted from the syllabus standard, e.g. "Natural resources and waste in the environment managed correctly."
- LESSON PROGRESSION with EXACTLY these stages in order: INTRODUCTION → LESSON DEVELOPMENT → EXERCISE / ASSESSMENT → HOMEWORK → CONCLUSION. LESSON DEVELOPMENT may be split into 2-3 consecutive entries named "LESSON DEVELOPMENT — Activity 1: <short title>" etc. when the lesson naturally has distinct timed activities (as official Mathematics and Science modules do). Do NOT invent other stage names — never use Engagement/Exploration/Explanation/Synthesis as stage names.
- Each stage has Teacher's Activities, Learners' Activities AND Assessment Criteria (observable learner behaviour). Stage durations MUST sum to the requested lesson duration (within 2 minutes).
- INTRODUCTION starts with a hook (question, scenario, song, picture, quick review). EXERCISE / ASSESSMENT produces evidence (written exercise, demonstration, presentation). HOMEWORK is one short task often involving family or the local community. CONCLUSION guides learners to bring out the main points themselves.
- Inside LESSON DEVELOPMENT let learners explore and discover BEFORE the teacher consolidates with formal explanation.
- Be concrete, not abstract — every activity is something a teacher could actually do tomorrow morning in a real Zambian classroom.
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
 *   numberOfPupils, boysPresent, girlsPresent, instructions
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
    '    "topic": string,     // include the syllabus code when known, e.g. "4.3 The Environment"',
    '    "subtopic": string,  // include the code when known, e.g. "4.3.1 Environmental Management"',
    '    "termAndWeek": string,',
    '    "boysPresent": number, "girlsPresent": number, "totalPupils": number,',
    '    "mediumOfInstruction": string',
    "  },",
    '  "generalCompetences": [string, ...],  // 3-5 from the CBC framework list',
    isPrevious
      ? '  "specificOutcome": string,           // the stated specific outcome(s) for this lesson'
      : '  "specificCompetence": string,         // WITH the syllabus code, e.g. "4.1.1.1 Practise safe and hygienic ways of handling food"',
    '  "lessonGoal": string,                 // ONE SMART sentence',
    '  "rationale": string,                  // content + value + methods + position, ending "This is lesson K in a series of N."',
    '  "priorKnowledge": string,             // what learners already know related to this lesson',
    '  "references": [string, ...],          // 2-3 entries: subject syllabus with page, grade Teaching Module with page, optionally a textbook',
    '  "learningEnvironment": { "natural": string, "artificial": string, "technological": string },  // one line each; "" if genuinely not used',
    '  "materials": [string, ...],           // 3-6 specific teaching/learning materials with local alternatives',
    '  "expectedStandard": string,           // PASSIVE voice from the syllabus, e.g. "Road safety practised correctly."',
    '  "keyVocabulary": [string, ...],       // 4-8 entries "Term: short learner-friendly meaning"',
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

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
