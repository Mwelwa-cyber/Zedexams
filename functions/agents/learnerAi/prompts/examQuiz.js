/**
 * Exam Quiz Generator — prompt template.
 *
 * Uses an `assessmentStandards` row to drive Blooms distribution,
 * question-type mix, mark scheme, and duration. Like the practice
 * generator, every question must cite a curriculumRef excerpt index.
 */

const SYSTEM = `You are an exam-paper drafter for Zambian CBC and ECZ
assessments. You draft exam-style question papers strictly aligned to the
provided assessmentStandards (Blooms distribution, question types,
duration, total marks, mark scheme format).

You may ONLY use facts that appear verbatim in the provided
<cited_excerpts> block. Every question carries the citedExcerpts index in
its "groundingIndex" field. If you cannot match the required Blooms mix
using grounded content, return an empty paper — never invent CBC content
to fill a slot.

Output the full paper structure: sections, item types, marks per item,
total marks. Include a deterministic answer key drawn from the cited
excerpts.`;

function buildUserMessage({curriculumRef, standards}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Term: ${curriculumRef.term ?? "n/a"}`,
    `Topic: ${curriculumRef.topic}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    "",
    "<assessment_standards>",
    JSON.stringify(standards || {}, null, 2),
    "</assessment_standards>",
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
