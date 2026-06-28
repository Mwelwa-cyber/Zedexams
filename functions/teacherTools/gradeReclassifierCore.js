/**
 * Pure core for re-grading questions against the CBC syllabi.
 *
 * Grade 7 exam papers mix questions from Grades 4–7, so a question tagged
 * "Grade 7" may actually be a Grade 4/5/6 topic. This module builds a
 * topic → grade index from the syllabus topic list and resolves a question's
 * true grade deterministically. No firebase / fs deps — the caller supplies
 * the topic list, so it unit-tests under plain `node` (the *Core.js split).
 *
 * The AI fallback (for topics that don't cleanly match one grade) lives in
 * gradeReclassifier.js; this module is the deterministic half + the decision
 * precedence both paths share.
 */

/** Normalise a grade to the bank's plain digit convention: 'G4'/'Grade 4'/4 → '4'. */
function normalizeGradeValue(value) {
  const s = String(value == null ? "" : value).trim();
  const m = s.match(/(\d{1,2})/);
  if (m) return m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, ""); // ECE/F… kept as-is, rare
}

/** Canonical lookup key for a (subject, topic) pair: collapse case + punctuation. */
function normalizeTopicKey(subject, topic) {
  const sub = String(subject == null ? "" : subject)
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const top = String(topic == null ? "" : topic)
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return `${sub}|${top}`;
}

/**
 * Build a topic → grade index from syllabus topics.
 * @param {Array<{subject:string, grade:string, topic:string}>} topics
 * @returns {Map<string, Set<string>>}  normalizeTopicKey → Set of grade digits
 */
function buildGradeIndex(topics) {
  const index = new Map();
  for (const t of topics || []) {
    if (!t || !t.subject || !t.grade || !t.topic) continue;
    const key = normalizeTopicKey(t.subject, t.topic);
    if (key.split("|")[1] === "") continue; // skip empty topic
    if (!index.has(key)) index.set(key, new Set());
    index.get(key).add(normalizeGradeValue(t.grade));
  }
  return index;
}

/**
 * Look up a question's grade by its topic.
 * @returns {{grade:string|null, ambiguous:boolean}} a unique grade, or
 *   ambiguous=true when the topic spans grades, or grade=null when unmatched.
 */
function lookupGrade(index, subject, topic) {
  if (!index || !topic) return {grade: null, ambiguous: false};
  const grades = index.get(normalizeTopicKey(subject, topic));
  if (!grades || grades.size === 0) return {grade: null, ambiguous: false};
  if (grades.size === 1) return {grade: [...grades][0], ambiguous: false};
  return {grade: null, ambiguous: true};
}

const VALID_GRADES = new Set(["4", "5", "6", "7"]);

/**
 * Decide the final grade, precedence: a unique syllabus match > the AI grade >
 * the stored grade. Returns the grade (bank digit form) + which path decided.
 * @param {{storedGrade?:string, lookup?:{grade:string|null}, aiGrade?:string}} args
 * @returns {{grade:string, method:'syllabus'|'ai'|'unchanged'}}
 */
function decideGrade({storedGrade, lookup, aiGrade} = {}) {
  if (lookup && lookup.grade && VALID_GRADES.has(lookup.grade)) {
    return {grade: lookup.grade, method: "syllabus"};
  }
  const ai = normalizeGradeValue(aiGrade);
  if (VALID_GRADES.has(ai)) {
    return {grade: ai, method: "ai"};
  }
  return {grade: normalizeGradeValue(storedGrade), method: "unchanged"};
}

module.exports = {
  normalizeGradeValue,
  normalizeTopicKey,
  buildGradeIndex,
  lookupGrade,
  decideGrade,
  VALID_GRADES,
};
