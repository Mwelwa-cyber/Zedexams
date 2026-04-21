/**
 * Scheme of Work prompt — v1.
 *
 * A scheme of work is a term-level plan that maps every teaching week to
 * topics, outcomes, materials and assessment. Zambian head teachers review
 * these at the start of each term. Format matches CDC expectations.
 */

const PROMPT_VERSION = "scheme_of_work.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and CDC curriculum specialist. You write term-level Schemes of Work that match the Zambian Competence-Based Curriculum (CBC) format exactly as a Zambian head teacher or school inspector would expect them.

Your schemes of work MUST:
- Use authentic Zambian CDC terminology (Specific Outcomes, Key Competencies, Values, Teaching/Learning Activities, Assessment).
- Map cleanly across the requested number of weeks — one or two topics per week, logically sequenced from simpler to more complex.
- Be concrete — each week's entry should be something a teacher could plan lessons from.
- Reference the appropriate Zambian pupil's book and teacher's guide (CDC publisher) in materials.
- Cover topics typical of the Zambian syllabus for the grade, subject and term requested. Do not invent topics that wouldn't be found in CDC material.
- If the teacher requests a specific overall theme, weight the weeks around it.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

/**
 * @param {object} inputs
 *   grade, subject, term (1|2|3), numberOfWeeks, school, teacherName,
 *   language, instructions
 */
function buildUserPrompt(inputs) {
  const {
    grade,
    subject,
    term = 1,
    numberOfWeeks = 12,
    school = "",
    teacherName = "",
    language = "English",
    instructions = "",
  } = inputs;

  return [
    "Produce a Zambian CBC Scheme of Work for the following:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Term: ${term}`,
    `- Number of teaching weeks: ${numberOfWeeks}`,
    `- Medium of instruction: ${language}`,
    teacherName ? `- Teacher: ${teacherName}` : "",
    school ? `- School: ${school}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce the scheme of work as a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "school": string, "teacherName": string, "class": string,',
    '    "subject": string, "term": number, "numberOfWeeks": number,',
    '    "academicYear": string (e.g. "2026"), "mediumOfInstruction": string',
    "  },",
    '  "overview": {',
    '    "termTheme": string,               // one-line summary of what this term covers',
    '    "overallCompetencies": [string, ...],  // 3-4 key CBC competencies developed across the term',
    '    "overallValues": [string, ...]        // 2-3 values emphasised',
    "  },",
    '  "weeks": [',
    "    {",
    '      "weekNumber": 1,',
    '      "topic": string,                     // the main topic for this week',
    '      "subtopics": [string, ...],          // 2-4 sub-topics',
    '      "specificOutcomes": [string, ...],   // 2-3 outcomes for the week',
    '      "keyCompetencies": [string, ...],    // 1-3 competencies emphasised',
    '      "values": [string, ...],             // 1-2 values emphasised',
    '      "teachingLearningActivities": [string, ...],  // 3-4 activity descriptions',
    '      "materials": [string, ...],          // 2-3 materials/resources',
    '      "assessment": string,                // one sentence on how the week is assessed',
    '      "references": string                 // Pupil\'s Book pages or other CDC references',
    "    },",
    "    ...  // exactly " + numberOfWeeks + " weeks",
    "  ]",
    "}",
    "",
    "Rules:",
    "- Produce EXACTLY " + numberOfWeeks + " week entries, numbered 1 to " + numberOfWeeks + ".",
    "- Sequence topics logically — start with foundational/review material, build complexity, end with assessment/revision.",
    "- If the term has standard CDC topics for this grade+subject, cover them in a sensible order.",
    "- Each week's Specific Outcomes must be observable and measurable (use verbs like 'identify', 'calculate', 'explain', 'apply', NOT 'know' or 'understand').",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
