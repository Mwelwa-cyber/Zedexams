/**
 * Notes Generator — prompt builders.
 *
 * Inputs:
 *   - curriculumReader (v2 agent contract) → grade, subject, term,
 *     topic, subtopic, competencies[], learningOutcomes[],
 *     keyConcepts[], suggestedContent[], citedExcerpts[].
 *   - parameters (notesParametersSchema) → detailLevel, includeDiagrams,
 *     numExamples, numKeyVocabulary.
 *
 * Hard rules baked into the prompt:
 *   - Only use facts from <cited_excerpts>. No outside knowledge.
 *   - Simple, learner-friendly Zambian English.
 *   - Avoid foreign place names and currencies unless the excerpts
 *     use them. Prefer Zambian examples (Lusaka, Kafue, ZMW, nshima,
 *     chitenge, ECZ, etc.).
 *   - Vocabulary terms come from the KB's `keyConcepts` when present.
 *   - Examples follow the structure {title, explanation} with concrete
 *     Zambian context.
 *   - Summary is one or two paragraphs; quickRevision is bullets.
 */

const SYSTEM = `You write Zambian CBC-aligned learner study notes.

Your job: produce a single, learner-friendly notes page on the requested
topic. Notes are read by Zambian school learners — primary, junior or
senior secondary — so language, examples, and depth must match the
grade level given.

You may ONLY use facts that appear in the <cited_excerpts> block. If
a fact is not in the excerpts, OMIT it rather than invent CBC content.

Notes structure (non-negotiable):
  - title: a short, clear topic title.
  - shortExplanation: 1-3 sentences introducing the topic.
  - keyVocabulary: term + plain-English definition. Use the KB's
    keyConcepts as your starting list.
  - importantFacts: bullet points of the must-know facts.
  - examples: each example has a short title + a 1-3 sentence
    explanation. Use Zambian context (Kapiri Mposhi, Lusaka, Kafue,
    ZMW, nshima, chitenge, sukulu, ECZ, ...) when an example needs a
    setting.
  - summary: one or two paragraphs rounding up the topic.
  - rememberThis: 3-6 short imperative reminders ("Always check the
    denominator first.").
  - diagramSuggestions: textual sketches of helpful diagrams. No
    image files — these are TODO notes for a teacher to draw.
    Only include if the parameters say includeDiagrams.
  - quickRevision: 4-10 bullet points the learner can scan in 60s.
  - estimatedReadingMinutes: realistic estimate (3-15 minutes).

Language standards:
  - Lower-primary (G1-G4): short sentences (≤15 words), avoid words
    over 14 letters.
  - Upper-primary (G5-G7): 1-2 clauses per sentence.
  - Secondary (G8-G12): clear paragraphs, technical terms only when
    defined in keyVocabulary.

You MUST emit your output via the learner_notes_output tool. Do not
return prose.`;

function selectExcerpts(curriculumReader) {
  const excerpts = curriculumReader && Array.isArray(curriculumReader.citedExcerpts) ?
    curriculumReader.citedExcerpts : [];
  return excerpts
      .map((e, i) => `[${i}] (${e.anchor || "module"}) ${e.text}`)
      .join("\n");
}

function detailGuidance(detailLevel) {
  if (detailLevel === "brief") {
    return "Brief notes: aim for 200-350 words across all sections. " +
      "Keep examples to 1-2 short ones.";
  }
  if (detailLevel === "detailed") {
    return "Detailed notes: aim for 700-1100 words. Include longer " +
      "examples + multiple importantFacts.";
  }
  return "Standard notes: aim for 400-700 words.";
}

function buildUserMessage({curriculumReader, parameters}) {
  const p = parameters || {};
  const detailLevel = p.detailLevel || "standard";
  const includeDiagrams = p.includeDiagrams !== false;
  const numExamples = Number.isInteger(p.numExamples) ? p.numExamples : 3;
  const numKeyVocabulary = Number.isInteger(p.numKeyVocabulary) ?
    p.numKeyVocabulary : 5;

  const lines = [
    `Grade: ${curriculumReader.grade}`,
    `Subject: ${curriculumReader.subject}`,
    `Term: ${curriculumReader.term ?? "n/a"}`,
    `Topic: ${curriculumReader.topic}`,
    `Sub-topic: ${curriculumReader.subtopic || "n/a"}`,
    `Lesson number: ${curriculumReader.lessonNumber ?? "n/a"}`,
    `Source document: ${curriculumReader.sourceDocId} ` +
      `(${curriculumReader.curriculumDocumentPath})`,
    `Curriculum version: ${curriculumReader.curriculumVersion}`,
    "",
    detailGuidance(detailLevel),
    `Target counts: ~${numKeyVocabulary} vocabulary terms, ` +
      `~${numExamples} examples.`,
    `Diagrams: ${includeDiagrams ? "include 2-4 diagram suggestions" : "do NOT include diagrams"}.`,
    "",
    "Competencies to assess (from the KB module):",
    ...(curriculumReader.competencies || []).slice(0, 6).map((c) => `  - ${c}`),
    "",
    "Learning outcomes (from the KB module):",
    ...(curriculumReader.learningOutcomes || []).slice(0, 6).map((o) => `  - ${o}`),
    "",
    "Key concepts (use these as vocabulary anchors):",
    ...(curriculumReader.keyConcepts || []).slice(0, 8).map((k) => `  - ${k}`),
    "",
    "Suggested content (from the KB module):",
    ...(curriculumReader.suggestedContent || []).slice(0, 6).map((s) => `  - ${s}`),
    "",
    "<cited_excerpts>",
    selectExcerpts(curriculumReader),
    "</cited_excerpts>",
    "",
    "Emit your output by calling the learner_notes_output tool.",
  ];
  return lines.join("\n");
}

module.exports = {SYSTEM, buildUserMessage, detailGuidance, selectExcerpts};
