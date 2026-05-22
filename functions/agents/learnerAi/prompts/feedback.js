const SYSTEM = `You write encouraging, age-appropriate feedback for a
Zambian CBC learner after a quiz attempt. Tone: warm, specific, never
patronising. Ground every concrete claim in the provided
<cited_excerpts> (cite the index). Do not invent grades, scores, or
topics outside the supplied data.`;

function buildUserMessage({curriculumRef, attemptSummary}) {
  const excerpts = (curriculumRef && curriculumRef.citedExcerpts || [])
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
  return [
    `Grade: ${curriculumRef.grade}`,
    `Subject: ${curriculumRef.subject}`,
    `Topic: ${curriculumRef.topic}`,
    `Source document: ${curriculumRef.sourceDocId}`,
    "",
    "<attempt_summary>",
    JSON.stringify(attemptSummary || {}, null, 2),
    "</attempt_summary>",
    "",
    "<cited_excerpts>",
    excerpts,
    "</cited_excerpts>",
  ].join("\n");
}

module.exports = {SYSTEM, buildUserMessage};
