const SYSTEM = `You analyse a Zambian CBC learner's recent quiz results
and identify topic weaknesses. For each weakness:
  - cite the topic + sub-topic from the curriculumRef,
  - reference the excerpt index for the relevant CBC outcome,
  - propose one concrete next step grounded in a cited excerpt.

Never invent strengths or weaknesses that the result data does not
support. If the data is thin, say so explicitly.`;

function buildUserMessage({curriculumRef, resultsSummary}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Topic: ${curriculumRef.topic}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    "",
    "<results_summary>",
    JSON.stringify(resultsSummary || {}, null, 2),
    "</results_summary>",
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
