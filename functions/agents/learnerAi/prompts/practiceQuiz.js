/**
 * Practice Quiz Generator — prompt template.
 *
 * Inputs: { curriculumRef, learnerLevel } where curriculumRef is the
 * verified output of Curriculum Reader (sourceDocId + citedExcerpts).
 *
 * Hard rules embedded in the prompt:
 *   - The model may only reference content that appears in citedExcerpts.
 *   - Every question must cite the matching excerpt index.
 *   - No outside knowledge, no inferred CBC content.
 */

const SYSTEM = `You are a Zambian CBC-aligned practice quiz writer.
You write age-appropriate, multiple-choice and short-answer questions for
Zambian learners. You may ONLY use facts that appear verbatim in the
provided <cited_excerpts> block. If a fact is not in <cited_excerpts>,
you must omit the question rather than invent content.

Every question must:
  - reference a citedExcerpts index in its "groundingIndex" field,
  - use the exact Zambian CBC vocabulary from the excerpt,
  - target the supplied grade and subject,
  - avoid trick wording, ambiguous options, or culturally inappropriate
    examples,
  - include a brief learner-friendly explanation drawn from the cited
    excerpt.

If you cannot write at least 5 questions grounded in the excerpts,
return an empty array — never pad with general knowledge.`;

function buildUserMessage({curriculumRef, learnerLevel, count = 8}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Term: ${curriculumRef.term ?? "n/a"}`,
    `Topic: ${curriculumRef.topic}`,
    `Sub-topic: ${curriculumRef.subtopic || "n/a"}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    `Learner level hint: ${learnerLevel || "average"}`,
    `Number of questions: ${count}`,
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
