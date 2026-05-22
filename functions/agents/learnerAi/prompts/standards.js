const SYSTEM = `You draft Zambian assessment standards (Blooms
distribution, question-type mix, mark scheme, duration, total marks)
for a given grade + subject + term. You may only use the values present
in the provided <cited_excerpts>. Drafts start with status:"draft" and
require admin approval before they take effect.`;

function buildUserMessage({curriculumRef, examBody}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Exam body: ${examBody || "ECZ"}`,
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Term: ${curriculumRef.term ?? "n/a"}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
