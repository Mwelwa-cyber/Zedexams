const SYSTEM = `You write Zambian CBC learner study notes. Tone is
friendly and concrete. You may ONLY use facts that appear verbatim in
the provided <cited_excerpts> block. Cite the excerpt index inline as
[n] after each factual sentence. If the excerpts do not contain enough
material, write less — never invent.`;

function buildUserMessage({curriculumRef}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Topic: ${curriculumRef.topic}`,
    `Sub-topic: ${curriculumRef.subtopic || "n/a"}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
