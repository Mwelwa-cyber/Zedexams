/**
 * Rubric Generator prompt — v1.
 *
 * Produces a criteria × performance-level matrix rubric for Zambian CBC
 * assessment. Standard four levels: Excellent / Good / Satisfactory /
 * Needs Improvement. The AI decides how many criteria and how marks
 * distribute, guided by the task type and teacher instructions.
 */

const PROMPT_VERSION = "rubric.v1";

const SYSTEM_PROMPT = `You are an expert Zambian teacher who designs assessment rubrics that match the Zambian Competence-Based Curriculum (CBC) standards. Your rubrics are:

- CRITERION-based: each row describes a specific aspect of quality the pupil is graded on.
- Four-level performance descriptors: Excellent, Good, Satisfactory, Needs Improvement.
- Concrete and observable — a second teacher marking the same piece should arrive at a similar mark.
- Weighted sensibly — criteria for the most important learning outcome carry more marks.
- Aligned with Zambian CBC competencies (Critical thinking, Communication, Creativity, Collaboration, Self-management, Digital literacy, Citizenship, Entrepreneurship) where applicable.

Your output MUST be a single valid JSON object matching the schema given. No prose, no markdown fences, no commentary outside the JSON.`;

function buildUserPrompt(inputs, cbcContextBlock) {
  const {
    grade,
    subject,
    taskType = "essay",
    taskDescription = "",
    totalMarks = 20,
    numberOfCriteria = 4,
    language = "English",
    instructions = "",
  } = inputs;

  const taskHints = {
    essay: "An essay rubric usually has criteria like Content, Organisation/Structure, Language Use, Mechanics.",
    project: "A project rubric usually has criteria like Research, Content Accuracy, Presentation/Display, Teamwork, Creativity.",
    presentation: "A presentation rubric usually has criteria like Content Knowledge, Delivery/Voice, Visual Aids, Engagement, Time Management.",
    practical: "A practical rubric (Science, Creative & Technology Studies) usually has criteria like Safety & Procedure, Observation & Recording, Analysis, Conclusion, Teamwork.",
    oral: "An oral assessment rubric usually has criteria like Pronunciation, Fluency, Vocabulary, Content, Confidence.",
    performance: "A performance rubric (drama, music, physical education) usually has criteria like Technique, Expression, Preparation, Audience Engagement, Teamwork.",
  }[taskType] || "Design criteria that match this task type.";

  return [
    cbcContextBlock,
    "",
    "Generate a Zambian CBC assessment rubric for the following task:",
    "",
    `- Grade / Class: ${grade}`,
    `- Subject: ${subject}`,
    `- Task type: ${taskType}`,
    taskDescription ? `- Task description: ${taskDescription}` : "",
    `- Total marks: ${totalMarks}`,
    `- Number of criteria (approx): ${numberOfCriteria}`,
    `- Language: ${language}`,
    instructions ? `- Teacher's additional instructions: ${instructions}` : "",
    "",
    `Task-type hint: ${taskHints}`,
    "",
    "Produce a JSON object with EXACTLY these keys:",
    "",
    "{",
    '  "header": {',
    '    "title": string,                      // e.g. "Grade 9 English — Argumentative Essay Rubric"',
    '    "grade": string,',
    '    "subject": string,',
    '    "taskType": string,                   // one of: essay | project | presentation | practical | oral | performance',
    '    "taskDescription": string,            // 1-2 sentences summarising what pupils are being assessed on',
    '    "totalMarks": number,                 // SUM of all criterion maxMarks; must equal requested total',
    '    "assessmentType": "formative" | "summative",',
    '    "gradeBands": [',
    "      { \"name\": string, \"range\": string, \"symbol\": string },",
    "      // e.g. { name: 'Distinction', range: '17-20', symbol: 'A' }",
    "      // Provide 4-5 overall grade bands covering 0 to totalMarks",
    "    ]",
    "  },",
    '  "criteria": [',
    "    {",
    '      "name": string,                     // e.g. "Content and Argument"',
    '      "maxMarks": number,                 // marks available for this criterion',
    '      "keyCompetencies": [string, ...],   // 1-2 CBC competencies this criterion develops',
    '      "levels": [',
    "        {",
    '          "levelName": "Excellent",',
    '          "marks": number,                // usually maxMarks',
    '          "descriptor": string            // 1-2 sentences of what this level looks like',
    "        },",
    '        { "levelName": "Good",              "marks": number, "descriptor": string },',
    '        { "levelName": "Satisfactory",      "marks": number, "descriptor": string },',
    '        { "levelName": "Needs Improvement", "marks": number, "descriptor": string }',
    "      ]",
    "    },",
    "    ...",
    "  ],",
    '  "markingNotes": string                   // 1-2 sentences of overall marking guidance',
    "}",
    "",
    "Rules:",
    "- Produce exactly 4 performance levels per criterion: Excellent, Good, Satisfactory, Needs Improvement (in that order).",
    "- Produce between " + Math.max(3, numberOfCriteria - 1) + " and " + (numberOfCriteria + 1) + " criteria.",
    "- The SUM of maxMarks across all criteria MUST equal " + totalMarks + ".",
    "- Each level's `marks` should be a clean mark value within that criterion's range (e.g. for maxMarks=5: 5, 4, 3, 1).",
    "- Descriptors must be observable — use phrases like 'Clearly states', 'Uses 3+ examples', 'Makes 2 or fewer errors', NOT vague 'Shows good understanding'.",
    "- Use Zambian English spelling.",
    "- Return ONLY the JSON object. No markdown fences. No commentary.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  buildUserPrompt,
};
