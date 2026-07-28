/**
 * Assemble the lesson-plan user prompt from typed fields.
 *
 * This is a port of the builder that used to run in the browser
 * (LessonPlanStudio.jsx, ~90 lines of `userPromptLines.push(...)`). Moving it
 * here is the point of the typed request: the client says WHAT the lesson is,
 * the server decides how that becomes instructions.
 *
 * ## It is pure, and it is tested as data
 *
 * No Firestore, no model, no `firebase-functions`. Given the same sanitized
 * request it returns the same string — which is what lets the fingerprint over
 * that request stand in for "the same generation", and what lets the prompt be
 * asserted line by line in a plain `node` test.
 *
 * ## The resource lines are a promise about the classroom
 *
 * `resourceLevel` is not decoration. A rural school on `minimal` must never be
 * handed a plan that needs a projector, so the constraint is stated in the
 * prompt rather than hoped for. These lines mirror
 * `src/config/schoolResources.js`; a `test:lesson-plan-prompt-mirror` guard
 * keeps them from drifting apart.
 */

/**
 * What each resource level tells the model it may assume.
 * Mirrors SCHOOL_RESOURCE_LEVELS[].promptLines in src/config/schoolResources.js.
 */
const RESOURCE_PROMPT_LINES = Object.freeze({
  minimal: [
    "- School resources: MINIMAL. Assume no electricity, no projector, no printed handouts.",
    "  Every activity must work with a chalkboard, the teacher's voice, and locally available objects.",
  ],
  basic: [
    "- School resources: BASIC. Chalkboard and exercise books are available; printing is limited.",
    "  Avoid activities that require electricity, computers or per-pupil handouts.",
  ],
  moderate: [
    "- School resources: MODERATE. Some printed materials and charts are available.",
    "  A small number of shared textbooks or posters may be used.",
  ],
  well_resourced: [
    "- School resources: WELL RESOURCED. Textbooks, printed handouts and some ICT are available.",
  ],
});

/** Teacher Settings → My AI, as instructions. Mirrors aiPrefsPromptLines(). */
function aiPreferenceLines(prefs) {
  const lines = [];
  lines.push(prefs.preferredEnglish === "american" ?
    "- Use American English spelling and vocabulary." :
    "- Use British English spelling and vocabulary (Zambian standard).");
  const inc = prefs.include;
  if (!inc.competencies) lines.push("- Do not include a competencies section.");
  if (!inc.specificOutcomes) lines.push("- Do not list specific learning outcomes.");
  if (!inc.teachingAids) lines.push("- Do not include a teaching/learning aids section.");
  if (!inc.homework) lines.push("- Do not include homework.");
  if (!inc.exercises) lines.push("- Do not include practice exercises.");
  if (!inc.reflection) lines.push("- Do not include a lesson reflection or evaluation section.");
  return lines;
}

const DETAIL_LABELS = Object.freeze({
  simplified: "Simplified — key points only, concise activities, short descriptions",
  standard: "Standard — balanced detail and clarity",
  detailed: "Detailed — comprehensive coverage, thorough activities, extended explanations",
});

const STYLE_LABELS = Object.freeze({
  simple: "Simple — plain accessible language a beginning teacher can follow",
  standard: "Standard — formal teacher language",
  professional: "Professional — formal, sophisticated vocabulary suitable for inspection",
});

/**
 * @param {Object} inputs A request already through `sanitizeLessonPlanRequest`.
 * @returns {string} The complete user prompt.
 */
function buildLessonPlanUserPrompt(inputs) {
  const isPrevious = inputs.curriculumMode === "previous";
  const lines = [
    isPrevious ?
      "Generate a Zambian lesson plan (Previous Curriculum / Outcomes-Based) for the following lesson:" :
      "Generate a Zambian CBC lesson plan for the following lesson:",
    "",
    `- Grade / Class: ${inputs.grade}`,
    `- Subject: ${inputs.subject}`,
    `- Topic: ${inputs.topic}`,
    inputs.subtopic ? `- Sub-topic: ${inputs.subtopic}` : "",
    inputs.totalLessons > 1 ?
      `- This is Lesson ${inputs.lessonNumber} of ${inputs.totalLessons} for this sub-topic.` : "",
    inputs.learningEnvironments.length ?
      `- Learning environment: ${inputs.learningEnvironments.join(", ")}` : "",
    ...(RESOURCE_PROMPT_LINES[inputs.resourceLevel] || RESOURCE_PROMPT_LINES.basic),
    `- Lesson duration: ${inputs.duration} minutes`,
    `- Medium of instruction: ${inputs.medium}`,
  ];

  const syl = inputs.syllabusContext;
  if (!isPrevious && (syl.specificCompetence || syl.learningActivities.length || syl.expectedStandard)) {
    lines.push("", "<cbc_context>");
    if (syl.specificCompetence) lines.push(`Specific Competence: ${syl.specificCompetence}`);
    if (syl.learningActivities.length) {
      lines.push(`Learning Activities (from syllabus): ${syl.learningActivities.join(" | ")}`);
    }
    if (syl.expectedStandard) lines.push(`Expected Standard: ${syl.expectedStandard}`);
    lines.push("</cbc_context>", "",
        "Ground the entire plan in this context. The specificCompetence drives every stage.");
  }

  if (isPrevious && inputs.selectedOutcomes.length) {
    lines.push("", "<previous_context>", "Specific Outcome(s) for this lesson:");
    inputs.selectedOutcomes.forEach((o, i) => lines.push(`${i + 1}. ${o}`));
    lines.push("</previous_context>", "",
        "Ground the lesson in achieving these specific outcomes. The lesson structure follows: " +
        "Introduction → Development → Conclusion → Homework.");
  }

  if (inputs.coveredContent.length) {
    lines.push(`Previously covered in this series (DO NOT repeat): ${inputs.coveredContent.join(" | ")}`);
  }
  if (inputs.lessonFocus) {
    lines.push(`Focus for THIS lesson: ${inputs.lessonFocus}`);
  }

  lines.push("", `- Lesson plan detail: ${DETAIL_LABELS[inputs.detail]}`);
  lines.push(`- Writing style: ${STYLE_LABELS[inputs.writingStyle]}`);
  lines.push(...aiPreferenceLines(inputs.aiPreferences));

  // Only meaningful when the medium of instruction is a Zambian language; the
  // studio disables the toggle otherwise, and the server re-checks rather than
  // trusting that it did.
  if (inputs.advancedOptions.localLanguage && inputs.medium && inputs.medium !== "English") {
    lines.push("",
        `- IMPORTANT: Write the lesson plan content (rationale, activities, explanations, ` +
        `examples and questions) in ${inputs.medium}, the local language of instruction — ` +
        `NOT in English. Keep the structural field labels and stage names in English so the ` +
        `document structure stays standard.`);
  }

  lines.push("", "Return ONLY the JSON object. No markdown fences. No commentary.");
  return lines.filter(Boolean).join("\n");
}

module.exports = {
  RESOURCE_PROMPT_LINES,
  DETAIL_LABELS,
  STYLE_LABELS,
  aiPreferenceLines,
  buildLessonPlanUserPrompt,
};
