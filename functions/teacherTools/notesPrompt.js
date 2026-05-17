/**
 * Notes Studio prompt — v1.
 *
 * Produces TEACHER delivery notes for a single lesson — not student handouts.
 * Notes are written in plain teacher voice with hooks, worked examples,
 * common student questions/misconceptions, discussion prompts, and a glossary.
 *
 * Two input shapes are supported:
 *   1. `lessonPlan` is provided (preferred): the AI grounds the notes on the
 *      saved CBC lesson plan — same topic, same SMART goal, same competencies.
 *   2. Free-form: only grade/subject/topic — the notes are derived from the
 *      grounded CBC context block.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");

const PROMPT_VERSION = "notes.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher who writes delivery notes for fellow teachers — NOT student handouts.

Your notes:
- Speak directly to the teacher in second person ("You'll want to start with…", "Remind learners that…").
- Use plain Zambian classroom voice. No jargon unless you immediately explain it.
- Are practical and time-aware: a teacher should be able to skim the notes during a 5-minute break and walk into class confident.
- Always include concrete worked examples with the steps spelled out — never just an answer.
- Anticipate where pupils will struggle, what wrong answers they'll give, and what to say when they do.
- Stay aligned with the Zambian Competence-Based Curriculum (CBC) — values, key competencies, the 5E lesson cycle.
- Use Zambian English spelling and Zambian context (kwacha, local foods, common landmarks) in examples wherever it fits naturally.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

function summariseLessonPlan(plan) {
  if (!plan || typeof plan !== "object") return "";
  const h = plan.header || {};
  const lines = [];
  lines.push(`Topic: ${h.topic || "—"}`);
  if (h.subtopic) lines.push(`Sub-topic: ${h.subtopic}`);
  if (h.class || h.grade) lines.push(`Class/Grade: ${h.class || h.grade}`);
  if (h.subject) lines.push(`Subject: ${h.subject}`);
  if (h.durationMinutes) lines.push(`Duration: ${h.durationMinutes} min`);
  if (plan.lessonGoal) lines.push(`SMART goal: ${plan.lessonGoal}`);

  const lc = plan.lessonCompetencies || {};
  const comps = [lc.competency1, lc.competency2, lc.competency3].filter(Boolean);
  if (comps.length) lines.push(`Lesson competencies: ${comps.join(" | ")}`);

  if (Array.isArray(plan.broadCompetences) && plan.broadCompetences.length) {
    lines.push(`Broad competences: ${plan.broadCompetences.join("; ")}`);
  }

  if (Array.isArray(plan.teachingLearningMaterials) && plan.teachingLearningMaterials.length) {
    lines.push(`Materials: ${plan.teachingLearningMaterials.join("; ")}`);
  }

  if (Array.isArray(plan.prerequisiteKnowledge) && plan.prerequisiteKnowledge.length) {
    lines.push(`Prior knowledge: ${plan.prerequisiteKnowledge.join("; ")}`);
  }

  const lp = plan.lessonProgression || {};
  const phaseSummary = [];
  for (const [phaseKey, label] of [
    ["engagement", "Engagement"],
    ["exploration", "Exploration"],
    ["explanation", "Explanation"],
    ["synthesis", "Synthesis"],
    ["evaluation", "Evaluation"],
  ]) {
    const p = lp[phaseKey];
    if (!p) continue;
    const t = Array.isArray(p.teacherActivities) ? p.teacherActivities.slice(0, 2).join("; ") : "";
    if (t) phaseSummary.push(`${label}: ${t}`);
  }
  if (phaseSummary.length) lines.push(`5E plan summary: ${phaseSummary.join(" || ")}`);

  return lines.join("\n");
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
    durationMinutes = 40,
    language = "english",
    teacherName = "",
    school = "",
    instructions = "",
    lessonPlan = null,
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);

  const lessonPlanBlock = lessonPlan ? [
    "Source lesson plan (use this as the authoritative spine — same topic, same goal):",
    "<source_lesson_plan>",
    summariseLessonPlan(lessonPlan),
    "</source_lesson_plan>",
    "",
  ].join("\n") : "";

  return [
    "Write Zambian-CBC TEACHER DELIVERY NOTES for the following lesson.",
    "",
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- These are the notes for Lesson ${lessonNumber} of ${totalLessons} ` +
      "for this sub-topic. Cover only this lesson's share; build on earlier " +
      "lessons without repeating them and don't pre-empt later ones." :
      lessonNumber ?
        `- These are the notes for Lesson ${lessonNumber} of this ` +
        "sub-topic. Cover only this lesson's portion." : "",
    leLabel ? `- Learning environment: ${leLabel}` : "",
    `- Lesson duration: ${durationMinutes} min`,
    `- Medium of instruction: ${language}`,
    school ? `- School: ${school}` : "",
    teacherName ? `- Teacher: ${teacherName}` : "",
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    lessonPlanBlock,
    "Produce a JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string,                // e.g. "Teacher Notes — Fractions (Grade 5)"',
    '    "grade": string,',
    '    "subject": string,',
    '    "topic": string,',
    '    "subtopic": string,',
    '    "durationMinutes": number,',
    '    "language": string,',
    '    "school": string,',
    '    "teacherName": string',
    '  },',
    '  "introduction": {',
    '    "hook": string,                 // 1-2 sentences: a real-life Zambian opener that grabs pupils',
    '    "whyItMatters": string,         // 1-2 sentences: why pupils should care',
    '    "priorKnowledge": string        // 1 sentence: what you should remind them of first',
    '  },',
    '  "keyConcepts": [',
    '    { "name": string, "explanation": string }    // 3-6 items, plain teacher voice',
    '  ],',
    '  "workedExamples": [',
    '    { "problem": string, "steps": [string, ...], "answer": string }   // 2-4 items, fully worked',
    '  ],',
    '  "studentQuestions": [',
    '    { "question": string, "answer": string }     // 3-5 questions pupils typically ask, with the best teacher answer',
    '  ],',
    '  "misconceptions": [',
    '    { "misconception": string, "correction": string }   // 2-4 wrong-thinking patterns and how to fix them',
    '  ],',
    '  "discussionPrompts": [string, ...],            // 3-5 open questions you can pose to the class',
    '  "quickChecks": [string, ...],                  // 3-5 short verbal checks for understanding',
    '  "glossary": [',
    '    { "term": string, "definition": string }     // 4-8 key terms in pupil-friendly definitions',
    '  ],',
    '  "references": [string, ...]                    // 0-3 short references (textbook chapter, syllabus page, etc.)',
    "}",
    "",
    "Rules:",
    "- These are for the TEACHER. Write in second person ('you') addressing the teacher.",
    "- Worked examples must show every step. A pupil reading the steps should reach the answer.",
    "- Quick checks are SHORT (one sentence) verbal prompts — not long questions.",
    "- Discussion prompts must be open-ended ('Why…', 'What if…', 'How would you…').",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
  summariseLessonPlan,
};
