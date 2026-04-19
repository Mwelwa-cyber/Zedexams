/**
 * CBC Knowledge Base — lookup, suggest, and context-rendering logic.
 *
 * Topic data lives in cbcTopics.js so this file stays focused on logic.
 * When the Firestore-backed admin editor ships, cbcTopics.js will become the
 * fallback loaded only when Firestore has no data for the requested grade.
 */

const {TOPICS} = require("./cbcTopics");

const KB_VERSION = "cbc-kb-2026-04-seed";

/**
 * Look up a topic. Fuzzy-matches on the topic string within a grade+subject.
 * Returns null if no confident match.
 */
function lookupTopic({grade, subject, topic}) {
  if (!grade || !subject || !topic) return null;
  const gradeNorm = String(grade).toUpperCase().replace(/\s+/g, "");
  const subjectNorm = String(subject).toLowerCase().replace(/[^a-z]/g, "_");
  const topicNorm = String(topic).toLowerCase().trim();
  const candidates = TOPICS.filter((t) =>
    t.grade.toUpperCase() === gradeNorm &&
    t.subject.toLowerCase() === subjectNorm,
  );
  if (candidates.length === 0) return null;

  // Exact topic match wins.
  const exact = candidates.find(
    (t) => t.topic.toLowerCase() === topicNorm,
  );
  if (exact) return exact;

  // Contains-match — either direction (topic contains candidate, or vice versa).
  const contains = candidates.find((t) => {
    const cand = t.topic.toLowerCase();
    return cand.includes(topicNorm) || topicNorm.includes(cand);
  });
  if (contains) return contains;

  // Sub-topic match.
  const subMatch = candidates.find((t) =>
    t.subtopics.some(
      (s) => s.toLowerCase().includes(topicNorm) ||
             topicNorm.includes(s.toLowerCase()),
    ),
  );
  if (subMatch) return subMatch;

  // Token-overlap fallback (>= 1 shared non-stopword token).
  const STOP = new Set([
    "the", "and", "of", "a", "an", "to", "with", "in", "for", "on",
  ]);
  const topicTokens = topicNorm
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t));
  const partial = candidates.find((t) => {
    const candTokens = t.topic.toLowerCase().split(/\s+/);
    return topicTokens.some((tok) => candTokens.includes(tok));
  });
  return partial || null;
}

/**
 * Suggest up to 5 topic strings for a grade + subject. Used when we can't
 * find a confident match — teacher sees: "Did you mean one of these?"
 */
function suggestTopics({grade, subject}) {
  const gradeNorm = String(grade || "").toUpperCase().replace(/\s+/g, "");
  const subjectNorm = String(subject || "").toLowerCase().replace(/[^a-z]/g, "_");
  return TOPICS
    .filter((t) =>
      t.grade.toUpperCase() === gradeNorm &&
      t.subject.toLowerCase() === subjectNorm,
    )
    .map((t) => t.topic)
    .slice(0, 5);
}

/**
 * Render a topic entry as the `<cbc_context>` block we inject into the prompt.
 */
function renderContextBlock(entry) {
  if (!entry) return "";
  const subs = entry.subtopics.map((s) => `- ${s}`).join("\n");
  const outcomes = entry.specificOutcomes.map((s) => `- ${s}`).join("\n");
  const comps = entry.keyCompetencies.map((s) => `- ${s}`).join("\n");
  const vals = entry.values.map((s) => `- ${s}`).join("\n");
  const mats = entry.suggestedMaterials.map((s) => `- ${s}`).join("\n");
  return [
    "<cbc_context>",
    `Grade: ${entry.grade}`,
    `Subject: ${entry.subject}`,
    `Term: ${entry.term}`,
    `Topic: ${entry.topic}`,
    "",
    "Official sub-topics covered under this topic in the CDC syllabus:",
    subs,
    "",
    "Typical Specific Outcomes:",
    outcomes,
    "",
    "Key Competencies most relevant here:",
    comps,
    "",
    "Values typically emphasised:",
    vals,
    "",
    "Suggested Teaching/Learning Materials:",
    mats,
    "</cbc_context>",
  ].join("\n");
}

/**
 * Fallback context used when the KB has no confident match. Rather than
 * rejecting the request, give Claude a structured brief that leans on its
 * general knowledge of the Zambian CBC.
 */
function renderFallbackContext({grade, subject, topic, subtopic}) {
  return [
    "<cbc_context>",
    `Grade: ${grade}`,
    `Subject: ${subject}`,
    `Topic: ${topic}`,
    subtopic ? `Sub-topic: ${subtopic}` : "",
    "",
    "NOTE: This specific topic is not in our curated Zambian CBC topic list",
    "yet. Produce the lesson plan using your expert knowledge of the Zambian",
    "Competence-Based Curriculum (2013 framework, CDC) for this grade and",
    "subject. Guidelines:",
    "",
    "- Use authentic Zambian CDC terminology: Specific Outcomes, Key",
    "  Competencies, Values, Pupils' Activities, Teacher's Activities,",
    "  Teacher's Reflection.",
    "- Align Specific Outcomes, Key Competencies and Values with what CDC",
    "  typically emphasises at this grade level.",
    "- If you are unsure whether this exact topic is part of the official",
    "  Zambian syllabus at this grade, still produce a usable lesson plan,",
    "  adapting the sub-topic breakdown to the closest CBC-aligned concept.",
    "- Cite the appropriate grade-and-subject Pupil's Book (CDC) when listing",
    "  teaching materials.",
    "</cbc_context>",
  ].filter(Boolean).join("\n");
}

/**
 * High-level resolver used by the Cloud Function. Returns:
 *   { contextBlock, kbMatch, kbWarning }
 * where kbMatch is the KB topic entry (or null) and kbWarning is either null
 * or a human-readable string to surface in the UI.
 */
function resolveCbcContext({grade, subject, topic, subtopic}) {
  const match = lookupTopic({grade, subject, topic});
  if (match) {
    return {
      contextBlock: renderContextBlock(match),
      kbMatch: match,
      kbWarning: null,
    };
  }
  const suggestions = suggestTopics({grade, subject});
  return {
    contextBlock: renderFallbackContext({grade, subject, topic, subtopic}),
    kbMatch: null,
    kbWarning: suggestions.length ?
      `"${topic}" isn't in our verified syllabus list yet — used general ` +
      `CBC knowledge. Nearby verified topics for this grade+subject: ` +
      `${suggestions.join(", ")}.` :
      `"${topic}" used general CBC knowledge (no verified syllabus data for ` +
      `this grade+subject yet).`,
  };
}

module.exports = {
  KB_VERSION,
  lookupTopic,
  suggestTopics,
  renderContextBlock,
  renderFallbackContext,
  resolveCbcContext,
  _topics: TOPICS,
};
