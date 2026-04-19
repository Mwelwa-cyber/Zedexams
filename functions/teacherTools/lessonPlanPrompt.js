/**
 * Lesson Plan Generator prompt — v1.
 *
 * When you iterate, COPY this file to v2 and update the resolver below rather
 * than editing v1 in place. Older aiGenerations documents record the prompt
 * version used so you can reproduce historical outputs.
 */

const PROMPT_VERSION = "lesson_plan.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and CDC (Curriculum Development Centre) curriculum specialist. You write lesson plans that match the Zambian Competence-Based Curriculum (CBC) format exactly as a Zambian head teacher or School Inspector would expect to see them.

Your lesson plans MUST:
- Use authentic Zambian CDC terminology (Specific Outcomes, Key Competencies, Values, Lesson Development, Pupils' Activities, Teacher's Activities, Teacher's Reflection).
- Reference Grade, Subject, Topic and Sub-topic explicitly.
- Follow a three-phase body: Introduction → Lesson Development (one or more steps) → Conclusion.
- For each phase/step, list Teacher's Activities and Pupils' Activities in parallel.
- Total phase durations to roughly match the requested lesson duration.
- Be concrete, not abstract. Every activity should be something a teacher could actually do tomorrow morning in a real Zambian classroom.
- Be culturally grounded in Zambia: use Zambian examples (Kwacha, local foods like nshima, local place names like Lusaka/Kitwe/Ndola) where natural, never where forced.
- Ground the content in the <cbc_context> block you are given. Do not invent sub-topics, Specific Outcomes or Key Competencies that are not already listed there or consistent with it.

Your output MUST be a single valid JSON object matching the exact schema given. No prose, no markdown fences, no commentary outside the JSON.`;

/**
 * @param {object} inputs
 *   grade, subject, topic, subtopic, durationMinutes, language,
 *   teacherName, school, numberOfPupils, instructions (optional)
 * @param {string} cbcContextBlock - rendered <cbc_context>...</cbc_context>
 */
function buildUserPrompt(inputs, cbcContextBlock) {
  const {
    grade,
    subject,
    topic,
    subtopic = "",
    durationMinutes = 40,
    language = "English",
    teacherName = "",
    school = "",
    numberOfPupils = 40,
    instructions = "",
  } = inputs;

  return [
    cbcContextBlock,
    "",
    "Generate a Zambian CBC lesson plan for the following lesson:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    `- Lesson duration: ${durationMinutes} minutes`,
    `- Medium of instruction: ${language}`,
    `- Estimated number of pupils: ${numberOfPupils}`,
    teacherName ? `- Teacher name: ${teacherName}` : "",
    school ? `- School: ${school}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce the lesson plan as a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "school": string, "teacherName": string, "date": string (YYYY-MM-DD, use today if unknown),',
    '    "time": string, "durationMinutes": number, "class": string, "subject": string,',
    '    "topic": string, "subtopic": string, "termAndWeek": string, "numberOfPupils": number,',
    '    "mediumOfInstruction": string',
    "  },",
    '  "specificOutcomes": [string, ...]  // 3-4 measurable outcomes, each starting with "By the end of the lesson, pupils should be able to..."',
    '  "keyCompetencies": [string, ...]   // 2-3 from the Zambian CBC competencies',
    '  "values": [string, ...]            // 2-3 values relevant to the lesson',
    '  "prerequisiteKnowledge": [string, ...]  // 2-3 things pupils should already know',
    '  "teachingLearningMaterials": [string, ...]',
    '  "references": [ { "title": string, "publisher": string, "pages": string } ]',
    '  "lessonDevelopment": {',
    '    "introduction": { "durationMinutes": number, "teacherActivities": [string,...], "pupilActivities": [string,...] },',
    '    "development": [',
    '      { "stepNumber": 1, "title": string, "durationMinutes": number, "teacherActivities": [...], "pupilActivities": [...] },',
    "      ...    // 2-4 steps total",
    "    ],",
    '    "conclusion": { "durationMinutes": number, "teacherActivities": [...], "pupilActivities": [...] }',
    "  },",
    '  "assessment": {',
    '    "formative": [string, ...],',
    '    "summative": { "description": string, "successCriteria": string }',
    "  },",
    '  "differentiation": { "forStruggling": [string, ...], "forAdvanced": [string, ...] },',
    '  "homework": { "description": string, "estimatedMinutes": number }',
    "}",
    "",
    "Rules:",
    "- Introduction + all development-step durations + conclusion must sum to within 2 minutes of the requested lesson duration.",
    "- For each phase/step, teacherActivities and pupilActivities should be PARALLEL (every teacher action has a matching pupil response).",
    "- Specific Outcomes must be observable and measurable (use verbs like 'identify', 'calculate', 'explain', 'describe', 'apply', NOT 'know' or 'understand').",
    "- Use Zambian English spelling (e.g. 'colour', 'practise' as verb).",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
