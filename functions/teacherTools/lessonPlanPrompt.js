/**
 * Lesson Plan Generator prompt — v2.
 *
 * Rebuilt to match Bernard Tito's CBC Lesson Plan Template — preliminary
 * information (1.1–1.21), 5E Lesson Progression (2.1–2.5), and Competence
 * Continuity and Strategy (3).
 *
 * When you iterate, COPY this file to v3 and update the resolver below
 * rather than editing v2 in place. Older aiGenerations documents record
 * the prompt version used so you can reproduce historical outputs.
 */

const PROMPT_VERSION = "lesson_plan.v2";

const SYSTEM_PROMPT = `You are an expert Zambian teacher and CDC (Curriculum Development Centre) curriculum specialist. You write Competency-Based Curriculum (CBC) lesson plans that match the Zambian CBC Lesson Plan Template exactly as a Zambian head teacher or School Inspector would expect to see them.

CBC focuses on developing competencies (what learners can DO) rather than just knowledge (what they know). Every section of your plan must contribute to competency development.

Your lesson plans MUST:
- Use authentic CBC terminology: Broad Competences, Expected Target Competence, Lesson Competencies, Methodology, Learning Environment, Interdisciplinary Connections, Engagement, Exploration, Explanation, Synthesis, Evaluation and Reflection, Competence Continuity.
- Use a SMART Lesson Goal — specific, measurable, achievable, relevant, time-bound.
- Specify three Lesson Competencies:
  1) Competency 1 — uses higher-order thinking verbs (analyse, evaluate, synthesise)
  2) Competency 2 — focuses on thinking processes (critical analysis, creative problem-solving)
  3) Competency 3 — a tangible skill-based output (model, prototype, demonstration)
- Follow the 5E progression: Engagement → Exploration → Explanation → Synthesis → Evaluation and Reflection.
- For each of the 5 phases, populate Teacher Activities, Learner Activities, AND Assessment Criteria.
- Total the five phase durations to match (within 2 minutes) the requested lesson duration.
- Be concrete, not abstract — every activity is something a teacher could actually do tomorrow morning in a real Zambian classroom.
- Be culturally grounded in Zambia: use Zambian examples (Kwacha, nshima, Lusaka/Kitwe/Ndola, local markets) where natural, never where forced.
- Purposefully choose a Learning Environment category (Natural, Artificial, Technological, or Classroom) that supports competency development — do not default to Classroom if another environment fits better.
- Populate Interdisciplinary Connections with 2–4 other subjects and show how the concept manifests there.
- Populate Competence Continuity — how the competencies continue developing beyond this one lesson.
- Ground content in the <cbc_context> block provided. Do not invent topics, outcomes, or competencies inconsistent with it.

Your output MUST be a single valid JSON object matching the exact schema given. No prose, no markdown fences, no commentary outside the JSON.`;

/**
 * @param {object} inputs
 *   grade, subject, topic, subtopic, durationMinutes, language,
 *   teacherName, school, numberOfPupils, boysPresent, girlsPresent,
 *   instructions (optional)
 */
function buildUserPrompt(inputs) {
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
    boysPresent = null,
    girlsPresent = null,
    instructions = "",
  } = inputs;

  return [
    "Generate a Zambian CBC lesson plan for the following lesson:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    `- Lesson duration: ${durationMinutes} minutes`,
    `- Medium of instruction: ${language}`,
    `- Estimated number of pupils: ${numberOfPupils}`,
    boysPresent != null ? `- Boys present: ${boysPresent}` : "",
    girlsPresent != null ? `- Girls present: ${girlsPresent}` : "",
    teacherName ? `- Teacher name: ${teacherName}` : "",
    school ? `- School: ${school}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    "Produce the lesson plan as a single JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "school": string, "teacherName": string, "date": string (YYYY-MM-DD, today if unknown),',
    '    "time": string, "durationMinutes": number, "class": string, "subject": string,',
    '    "topic": string, "subtopic": string, "termAndWeek": string,',
    '    "boysPresent": number, "girlsPresent": number, "totalPupils": number,',
    '    "mediumOfInstruction": string',
    "  },",
    '  "lessonGoal": string,   // ONE SMART statement. Must be Specific, Measurable, Achievable, Relevant, Time-bound.',
    '  "broadCompetences": [string, ...],  // 2-3 from framework — e.g. Critical Thinking, Collaboration, Communication',
    '  "expectedTargetCompetence": string, // single statement from the syllabus',
    '  "lessonCompetencies": {',
    '    "competency1": string,  // higher-order thinking verbs (analyse, evaluate, synthesise)',
    '    "competency2": string,  // thinking process (critical analysis, creative problem-solving)',
    '    "competency3": string   // TANGIBLE skill-based output (a model, prototype, demonstration)',
    "  },",
    '  "methodology": {',
    '    "approach": string,        // e.g. inquiry-based learning / project-based learning',
    '    "strategies": [string,...] // specific strategies — e.g. think-pair-share, jigsaw, guided discovery',
    "  },",
    '  "assessment": {',
    '    "formative": [string,...],  // continuous-assessment tools (observation checklist, exit ticket, questioning)',
    '    "summative": { "description": string, "successCriteria": string }',
    "  },",
    '  "teachingLearningMaterials": [string, ...],  // specific quantities + local alternatives',
    '  "learningEnvironment": {',
    '    "category": "natural" | "artificial" | "technological" | "classroom",',
    '    "specific": string,   // e.g. "School vegetable garden" or "Community health post"',
    '    "rationale": string   // why this environment supports the target competencies',
    "  },",
    '  "prerequisiteKnowledge": [string, ...],  // 2-3 concepts pupils should already have',
    '  "interdisciplinaryConnections": [',
    '    { "subject": string, "connection": string },  // 2-4 links to other subjects',
    "    ...",
    "  ],",
    '  "references": [ { "title": string, "publisher": string, "pages": string } ],',
    "",
    "  // Section 2 — 5E Lesson Progression",
    '  "lessonProgression": {',
    '    "engagement":  { "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
    '    "exploration": { "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
    '    "explanation": { "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
    '    "synthesis":   { "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] },',
    '    "evaluation":  { "durationMinutes": n, "teacherActivities": [...], "learnerActivities": [...], "assessmentCriteria": [...] }',
    "  },",
    "",
    "  // Section 3 — Competence Continuity and Strategy",
    '  "competenceContinuity": {',
    '    "longTermProjects":   [string,...],  // projects that build on this lesson beyond today',
    '    "homeworkExtensions": [string,...],  // homework applying the skill in new contexts',
    '    "upcomingConnections":[string,...],  // links to upcoming units',
    '    "teacherActions":     [string,...]   // check-ins, scaffolds, monitoring tools',
    "  },",
    "",
    '  "differentiation": { "forStruggling": [string, ...], "forAdvanced": [string, ...] },',
    '  "homework": { "description": string, "estimatedMinutes": number }',
    "}",
    "",
    "Rules:",
    "- Engagement + Exploration + Explanation + Synthesis + Evaluation durations must sum to within 2 minutes of the requested lesson duration.",
    "- For each 5E phase, teacherActivities and learnerActivities must be PARALLEL (every teacher move has a matching learner response).",
    "- competency3 MUST be a concrete, tangible output the learner produces (a drawing, model, recording, presentation, simple prototype) — not an abstract concept.",
    "- lessonGoal MUST pass the SMART test on its own, without reading the rest of the plan.",
    "- Specific action verbs only (identify, calculate, explain, describe, apply, design, construct). Never 'know' or 'understand'.",
    "- Use Zambian English spelling (e.g. 'colour', 'practise' as verb, 'programme').",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
