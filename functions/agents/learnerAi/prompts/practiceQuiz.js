/**
 * Practice Quiz Generator — prompt builders.
 *
 * Inputs (from chainContext.curriculumReader, src/schemas/learnerAi.js
 * → curriculumReaderOutputSchema):
 *   { grade, subject, term, topic, subtopic, lessonNumber,
 *     competencies[], learningOutcomes[], keyConcepts[], suggestedContent[],
 *     citedExcerpts[{text, anchor}], curriculumDocumentPath,
 *     curriculumVersion, sourceDocId, ... }
 *
 * Parameters (validated against practiceQuizParametersSchema):
 *   { numQuestions, difficulty, mode, allowedQuestionTypes[], lessonNumber,
 *     weakLearnerId }
 *
 * Hard rules baked into the prompt:
 *   - The model may only reference content from <cited_excerpts>.
 *     If a fact is not in the excerpts, OMIT the question — never
 *     pad with general knowledge.
 *   - Every question MUST cite a valid index from <cited_excerpts>
 *     in its `groundingIndex` field.
 *   - Use Zambian-friendly examples and CBC vocabulary.
 *   - No duplicate options, no trick wording, no ambiguous answers.
 *   - Each MCQ has exactly one defensibly-correct answer.
 *   - true_false answers are literally "True" or "False".
 *   - matching questions populate matchingPairs[] (not options[]).
 *   - short_answer questions have options:[] and a canonical
 *     correctAnswer string.
 */

const SYSTEM = `You are a Zambian CBC-aligned practice quiz writer for learners.

Your job: write age-appropriate practice quizzes grounded in the official
Zambian Competence-Based Curriculum (CBC). You may ONLY use facts that
appear verbatim in the <cited_excerpts> block. If a fact is not in the
excerpts, OMIT the question rather than invent content.

Question-writing standards:
  - Use simple, learner-friendly language. Avoid jargon unless the
    excerpts define it.
  - Prefer Zambian examples (Kapiri Mposhi, Lusaka, ZMW, chitenge,
    nshima, ECZ, etc.) when an example is needed. Avoid foreign place
    names or currencies unless the excerpts use them.
  - Every MCQ has 4 distinct options and exactly one correct answer
    that appears verbatim in the options array. No duplicate options.
    No "all of the above" / "none of the above" unless the excerpts
    explicitly teach that pattern.
  - true_false questions must have options=["True","False"] and a
    correctAnswer of "True" or "False".
  - short_answer questions must have options=[] and a single canonical
    correctAnswer string (no list of acceptable variants).
  - matching questions must populate matchingPairs (3–6 left/right
    pairs). options stays []. correctAnswer is "" (the pairs encode
    the key).
  - Each question's "explanation" is one to two sentences in
    learner-friendly tone, drawn from the cited excerpt.
  - Each question's "groundingIndex" is the index into <cited_excerpts>
    that the question and its explanation are derived from.
  - Each question's "difficulty" is one of: easy | medium | hard.
  - "marks" are 1–3 for easy, 2–4 for medium, 3–6 for hard.

If you cannot write at least the requested number of questions
grounded in <cited_excerpts>, return as many as you can. Never pad
with general knowledge to hit a quota.

You MUST emit your output via the practice_quiz_output tool. Do not
return prose.`;

function selectExcerpts(curriculumReader) {
  const excerpts = curriculumReader && Array.isArray(curriculumReader.citedExcerpts) ?
    curriculumReader.citedExcerpts : [];
  return excerpts
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
}

function difficultyMix(difficulty, numQuestions) {
  // Difficulty mix per the params:
  //   'easy'  → all easy
  //   'medium'→ all medium
  //   'hard'  → all hard
  //   'mixed' → ~40% easy, 40% medium, 20% hard (1-decimal rounding)
  if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") {
    return `All ${numQuestions} questions should be at "${difficulty}" difficulty.`;
  }
  const easy = Math.max(1, Math.round(numQuestions * 0.4));
  const hard = Math.max(1, Math.round(numQuestions * 0.2));
  const medium = Math.max(1, numQuestions - easy - hard);
  return `Mix: ~${easy} easy, ~${medium} medium, ~${hard} hard (these are guidance — favour what the excerpts can support).`;
}

function modeGuidance(mode, lessonNumber, subtopic, topic) {
  switch (mode) {
    case "topic":
      return `Mode: TOPIC quiz on "${topic}". Cover breadth across the topic; questions can span subtopics if the excerpts allow.`;
    case "subtopic":
      return `Mode: SUBTOPIC quiz on "${subtopic || topic}". Stay tight on this subtopic; don't drift.`;
    case "lesson":
      return `Mode: LESSON quiz for lesson ${lessonNumber || "?"} on "${topic}". Focus only on content from this lesson's excerpts.`;
    case "revision":
      return `Mode: REVISION quiz. Mix easier recall questions with one or two harder application questions. Useful as a refresher.`;
    default:
      return `Mode: ${mode}.`;
  }
}

function buildUserMessage({curriculumReader, parameters}) {
  const p = parameters || {};
  const numQuestions = Number.isInteger(p.numQuestions) ? p.numQuestions : 10;
  const difficulty = p.difficulty || "mixed";
  const mode = p.mode || "topic";
  const allowed = Array.isArray(p.allowedQuestionTypes) && p.allowedQuestionTypes.length ?
    p.allowedQuestionTypes : ["mcq", "true_false", "short_answer", "matching"];

  const lines = [
    `Grade: ${curriculumReader.grade}`,
    `Subject: ${curriculumReader.subject}`,
    `Term: ${curriculumReader.term ?? "n/a"}`,
    `Topic: ${curriculumReader.topic}`,
    `Sub-topic: ${curriculumReader.subtopic || "n/a"}`,
    `Lesson number: ${curriculumReader.lessonNumber ?? p.lessonNumber ?? "n/a"}`,
    `Source document: ${curriculumReader.sourceDocId} ` +
      `(${curriculumReader.curriculumDocumentPath})`,
    `Curriculum version: ${curriculumReader.curriculumVersion}`,
    "",
    `Number of questions requested: ${numQuestions}`,
    difficultyMix(difficulty, numQuestions),
    modeGuidance(mode, curriculumReader.lessonNumber || p.lessonNumber,
        curriculumReader.subtopic, curriculumReader.topic),
    `Allowed question types: ${allowed.join(", ")}`,
    "",
    "Competencies to assess (from the KB module):",
    ...(curriculumReader.competencies || []).slice(0, 6).map((c) => `  - ${c}`),
    "",
    "Learning outcomes (from the KB module):",
    ...(curriculumReader.learningOutcomes || []).slice(0, 6).map((o) => `  - ${o}`),
    "",
    "Key concepts (use as terminology anchors):",
    ...(curriculumReader.keyConcepts || []).slice(0, 8).map((k) => `  - ${k}`),
    "",
    "<cited_excerpts>",
    selectExcerpts(curriculumReader),
    "</cited_excerpts>",
    "",
    "Emit your output by calling the practice_quiz_output tool.",
  ];
  return lines.join("\n");
}

module.exports = {SYSTEM, buildUserMessage, difficultyMix, modeGuidance, selectExcerpts};
