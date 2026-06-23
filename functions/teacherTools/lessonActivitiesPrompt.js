/**
 * Lesson Activities prompt — v1.
 *
 * Drives the Lesson Plan Studio's "Assessment Activities" generator: a Class
 * Exercise (in-class practice) and/or Homework (independent take-home work)
 * built straight from the lesson the teacher just generated. Grounded on the
 * verified <curriculum_module> / <cbc_context> block when one is present, so
 * the questions assess exactly what the lesson taught.
 *
 * When iterating, COPY this file to v2 rather than editing v1 in place.
 */

const {learningEnvironmentLabel} = require("./learningEnvironments");

const PROMPT_VERSION = "lessonActivities.v1";

const SYSTEM_PROMPT = `You are an expert Zambian CBC teacher creating follow-up assessment activities for a lesson you have just planned.

You may be asked for a CLASS EXERCISE, a HOMEWORK, or both:
- CLASS EXERCISE — short practice learners do IN CLASS during or right after the lesson, so the teacher can check understanding immediately. Quick to mark.
- HOMEWORK — independent practice learners do AT HOME to consolidate the lesson. Includes a brief note to the parent/guardian on how to help (without doing it for the child).

Both must:
- Assess ONLY what THIS lesson covers — never material from later lessons or beyond the curriculum module supplied in context. Respect the lesson-in-a-series framing (Lesson N of M).
- Pull directly from the lesson's learning outcomes, specific competences, lesson objectives, teaching/learning activities and expected standards.
- Match the requested difficulty and question types, and stay age-appropriate for the grade.
- Use Zambian context (kwacha, nshima, local markets, Zambian place names, real learner names) where natural.
- Carry a COMPLETE answer key: every question has a correct answer; include fuller model answers and a short marking note when asked.

Question type meanings (use the exact \`type\` value shown):
- "multiple_choice": a stem plus 3–4 plausible options; \`answer\` is the correct option's LETTER (A, B, C, D) and \`options\` lists the option texts WITHOUT letters.
- "true_false": a statement; \`options\` is ["True","False"] and \`answer\` is "True" or "False".
- "short_answer": one or two sentences expected; \`answer\` is the expected response.
- "fill_in_blank": the \`prompt\` contains one or more blanks written as "_____"; \`answer\` gives the word(s) for the blank(s) in order.
- "matching": provide \`matchPairs\` as a list of {left, right} correct pairs; the studio shuffles them for the learner.
- "structured": a multi-part question; provide \`parts\` as a list of {label, prompt, answer, marks}.
- "calculation": a maths/science working question; put the final answer in \`answer\` and the steps in \`workingNotes\`.
- "essay": an extended-response prompt; put guidance/expected points in \`modelAnswer\`.

Hard rules:
- Output a SINGLE valid JSON object via the supplied tool. No prose, markdown fences, or commentary outside the tool call.
- Only include the activities that were requested.
- Use Zambian English spelling.`;

/**
 * Build the user prompt from the resolved lesson coordinates + the teacher's
 * activity settings.
 *
 * @param {object} inputs  sanitised inputs from generateLessonActivities
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
    language = "English",
    lessonObjectives = "",
    wantExercise = false,
    wantHomework = false,
    exercise = {},
    homework = {},
    includeMarkingGuide = true,
    includeModelAnswers = true,
    instructions = "",
  } = inputs;

  const leLabel = learningEnvironmentLabel(learningEnvironment);
  const wanted = [];
  if (wantExercise) wanted.push("a CLASS EXERCISE");
  if (wantHomework) wanted.push("a HOMEWORK");

  const lines = [
    `Create ${wanted.join(" and ")} for the following Zambian CBC lesson.`,
    "",
    "LESSON CONTEXT",
    `- Grade: ${grade}`,
    `- Subject: ${subject}`,
    `- Topic: ${topic}`,
    subtopic ? `- Sub-topic: ${subtopic}` : "",
    term ? `- Term: ${term}` : "",
    lessonNumber && totalLessons ?
      `- This is Lesson ${lessonNumber} of ${totalLessons} for this sub-topic. ` +
      "Assess only what this lesson covered." :
      lessonNumber ? `- Lesson ${lessonNumber} of this sub-topic.` : "",
    leLabel ? `- Learning environment used: ${leLabel}.` : "",
    `- Language: ${language}`,
    lessonObjectives ?
      `- Lesson objectives / focus to assess:\n${lessonObjectives}` : "",
    instructions ? `- Teacher's extra instructions: ${instructions}` : "",
    "",
  ];

  if (wantExercise) {
    lines.push(
        "CLASS EXERCISE SETTINGS",
        `- Number of questions (approx): ${exercise.count}`,
        `- Difficulty: ${exercise.difficulty}`,
        `- Question types to use: ${(exercise.questionTypes || []).join(", ") || "a sensible mix"}`,
        "- Keep it short enough to complete and mark within the lesson.",
        "",
    );
  }
  if (wantHomework) {
    lines.push(
        "HOMEWORK SETTINGS",
        `- Number of questions (approx): ${homework.count}`,
        `- Difficulty: ${homework.difficulty}`,
        `- Target time at home: ${homework.estimatedMinutes} minutes`,
        `- Question types to use: ${(homework.questionTypes || []).join(", ") || "a sensible mix"}`,
        "- Doable at home without special materials. Add a short parentNote.",
        "",
    );
  }

  lines.push(
      "ANSWER KEY",
      `- Include a marking guide / marking notes: ${includeMarkingGuide ? "YES" : "NO"}`,
      `- Include fuller model answers per question (modelAnswer): ${includeModelAnswers ? "YES" : "NO"}`,
      "- Every question MUST have a correct answer.",
      "",
      "OUTPUT",
      "Call the emit_lesson_activities tool with an object shaped like:",
      "{",
      wantExercise ? '  "exercise": { "header": { "title", "grade", "subject", "topic", "subtopic", "term", "difficulty", "estimatedMinutes", "totalMarks", "instructions" }, "instructions": string, "questions": [ { "number", "type", "prompt", "marks", "options"?: [string], "answer", "modelAnswer"?, "workingNotes"?, "matchPairs"?: [{ "left", "right" }], "parts"?: [{ "label", "prompt", "answer", "marks" }] } ], "answerKey": { "markingNotes" } },' : "",
      wantHomework ? '  "homework": { ...same shape as exercise..., "parentNote": string }' : "",
      "}",
      wantExercise && !wantHomework ? "Do NOT include a homework key." : "",
      wantHomework && !wantExercise ? "Do NOT include an exercise key." : "",
  );

  return lines.filter((l) => l !== "").join("\n");
}

module.exports = {PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt};
