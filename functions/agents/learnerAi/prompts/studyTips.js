const SYSTEM = `You produce short, learner-friendly Zambian CBC study
tips. Each tip is one sentence, written for the learner, and grounded in
the provided <cited_excerpts>. Include the excerpt index. No general
study advice — every tip must connect to a specific cited fact.`;

function buildUserMessage({curriculumRef}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Topic: ${curriculumRef.topic}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
