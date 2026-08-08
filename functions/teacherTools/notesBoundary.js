/**
 * Retrieve-then-write: the first half (§3b).
 *
 * Nothing is written until the syllabus has been read. This resolves the
 * outcomes, scope notes and vocabulary the chosen grade + subject + topic
 * actually carries, and hands them to the prompt as the boundary the notes are
 * written inside. It is the difference between "notes about the digestive
 * system" and "the notes this grade's syllabus asks for on the digestive
 * system".
 *
 * ## Three states, not two
 *
 * `grounded: true`   — outcomes were found; the count is what the studio's
 *                      grounding chip reports.
 * `grounded: false`  — the catalogue genuinely has nothing for this topic. The
 *                      studio shows the amber "not grounded" notice, and the
 *                      prompt is told to stay conservative. This is a fact
 *                      about the curriculum data, and the teacher is told it.
 * `unavailable: true`— the LOOKUP FAILED. Firestore blinked; the catalogue was
 *                      never read. Reporting that as "no syllabus data" would
 *                      tell the teacher something false about their curriculum,
 *                      so it is its own state with its own message.
 *
 * The one thing this module must never do is return `grounded: true` on a
 * guess. A grounding chip is a claim about provenance, and a false one is worse
 * than no chip at all.
 */

const {
  lookupTopic,
  lookupSubtopicModule,
  normalizeFramework,
} = require("./cbcKnowledge");

/** Sub-topics arrive as bare strings (legacy) or as `{name, …}` (parsed). */
function subtopicLabel(s) {
  if (typeof s === "string") return s.trim();
  if (s && typeof s === "object") return String(s.name || "").trim();
  return "";
}

const clean = (v, max = 260) => String(v || "").replace(/\s+/g, " ").trim().slice(0, max);

function uniq(list, max) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const value = clean(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The boundary for one set of notes.
 *
 * The sub-topic module is consulted FIRST when the teacher chose one, because a
 * stored module is the more specific source — a topic's outcomes cover the
 * whole topic, and notes for one sub-topic of it should not be measured against
 * all of them. When both exist the module's outcomes lead and the topic's fill
 * in behind, de-duplicated.
 */
async function resolveNotesBoundary({
  grade, subject, topic, subtopic, term, framework,
} = {}) {
  const fw = normalizeFramework(framework);
  const empty = {
    grounded: false,
    unavailable: false,
    outcomes: [],
    scopeNotes: [],
    vocabulary: [],
    source: "none",
    topicLabel: clean(topic),
    framework: fw,
  };

  if (!grade || !subject || !topic) return empty;

  let topicEntry = null;
  let moduleEntry = null;
  try {
    topicEntry = await lookupTopic({grade, subject, topic, framework: fw});
    if (subtopic && term) {
      moduleEntry = await lookupSubtopicModule({grade, subject, topic, subtopic, term});
    }
  } catch (err) {
    // Not "no syllabus data" — no READ. The caller must be able to tell the
    // teacher which of the two happened.
    console.error("[notesBoundary] syllabus lookup failed", {grade, subject, topic}, err);
    return {...empty, unavailable: true};
  }

  const outcomes = uniq([
    ...(moduleEntry && Array.isArray(moduleEntry.outcomes) ? moduleEntry.outcomes : []),
    ...(topicEntry && Array.isArray(topicEntry.specificOutcomes) ? topicEntry.specificOutcomes : []),
  ], 8);

  // Scope notes: what the syllabus says this topic actually contains. The
  // sub-topic list is the sharpest statement of scope the catalogue holds — it
  // names the ground the topic covers, which is also the ground it stops at.
  const scopeNotes = uniq([
    ...(moduleEntry && Array.isArray(moduleEntry.content) ? moduleEntry.content : []),
    ...(topicEntry && Array.isArray(topicEntry.subtopics) ?
      topicEntry.subtopics.map(subtopicLabel) : []),
  ], 10);

  // Vocabulary: the words the curriculum itself uses for this topic. Handing
  // these over is what keeps the notes on the book's terms rather than the
  // model's synonyms — the exam marks the book's words.
  const vocabulary = uniq([
    ...(moduleEntry && Array.isArray(moduleEntry.vocabulary) ? moduleEntry.vocabulary : []),
    ...(moduleEntry && Array.isArray(moduleEntry.keyTerms) ? moduleEntry.keyTerms : []),
    ...(topicEntry && Array.isArray(topicEntry.keyTerms) ? topicEntry.keyTerms : []),
  ], 12);

  const grounded = outcomes.length > 0;
  return {
    grounded,
    unavailable: false,
    outcomes,
    scopeNotes,
    vocabulary,
    source: moduleEntry ? "curriculum_module" : (topicEntry ? "syllabus_topic" : "none"),
    topicLabel: clean((topicEntry && topicEntry.topic) || topic),
    framework: fw,
  };
}

/**
 * What the studio's grounding chip renders, and the amber notice's wording.
 *
 * Built here rather than in the component so the studio, the saved document and
 * any later surface all say the same thing about the same document.
 */
function groundingSummary(boundary, {gradeLabel, subjectLabel} = {}) {
  if (!boundary || boundary.unavailable) {
    return {
      grounded: false,
      unavailable: true,
      outcomes: [],
      count: 0,
      label: "Syllabus check unavailable",
      message: "We could not read the syllabus while writing these notes, so " +
        "they are not grounded in it. Review them before use and try again " +
        "later for a grounded version.",
      source: "unavailable",
    };
  }
  if (!boundary.grounded) {
    return {
      grounded: false,
      unavailable: false,
      outcomes: [],
      count: 0,
      label: "Not grounded in a syllabus",
      message: "No syllabus data found for this topic — notes were generated " +
        "from general curriculum knowledge; review carefully before use.",
      source: boundary.source || "none",
    };
  }
  const where = [gradeLabel, subjectLabel].filter(Boolean).join(" ");
  const n = boundary.outcomes.length;
  return {
    grounded: true,
    unavailable: false,
    outcomes: boundary.outcomes,
    count: n,
    label: `Grounded in ${where || "the"} syllabus · ${n} outcome${n === 1 ? "" : "s"}`,
    message: "",
    source: boundary.source,
  };
}

module.exports = {resolveNotesBoundary, groundingSummary};
