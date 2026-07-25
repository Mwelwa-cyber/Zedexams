/**
 * Server mirror of src/utils/syllabusSubjectSplit.js — one syllabus document,
 * two canonical subjects.
 *
 * The Commerce & Principles of Accounts workbook lays two independently-numbered
 * syllabi end to end under one title. The boundary is in the data: topic codes
 * ascend through the first subject then reset. Keying off the reset means the
 * subject is never guessed from topic text.
 *
 * This exists server-side so resolveCbcContext grounds generation on the SAME
 * subjects the picker offers. If the two drift, a teacher picks a Commerce topic
 * and the AI's curriculum module has never heard of it.
 *
 * Keep in lock-step with the client copy (guarded by
 * scripts/test-syllabus-subject-split.mjs).
 */

const {parseTopicCode} = require("./syllabusTopicTree");

const SPLIT_DOCUMENTS = {
  "Commerce & Principles of Accounts Syllabus (Forms 1-4)": {
    sections: ["commerce", "principles_of_accounts"],
    // What a subject dropdown offers, same order as `sections`.
    sectionLabels: ["Commerce", "Principles of Accounts"],
    legacyKey: "commerce_and_principles_of_accounts",
  },
};

/** Numeric tuple comparison: [1,10] sorts after [1,9], not before. */
function compareSegments(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i] === undefined ? -1 : a[i];
    const right = b[i] === undefined ? -1 : b[i];
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Cut ordered topic labels into sections wherever the numbering restarts.
 * An unparseable label continues its section; an exact repeat never opens one.
 *
 * @param {string[]} topicLabels distinct topic labels in document order
 * @return {{sections: string[][], boundaries: number[]}} the cut sections
 */
function sectionsByCodeReset(topicLabels) {
  const labels = (topicLabels || [])
      .map((t) => String(t === null || t === undefined ? "" : t).trim())
      .filter(Boolean);
  const sections = [];
  const boundaries = [];
  let current = [];
  let highWater = null;

  labels.forEach((label, index) => {
    const parsed = parseTopicCode(label);
    if (parsed && highWater &&
        compareSegments(parsed.segments, highWater) < 0) {
      sections.push(current);
      boundaries.push(index);
      current = [];
      highWater = null;
    }
    current.push(label);
    if (parsed &&
        (!highWater || compareSegments(parsed.segments, highWater) > 0)) {
      highWater = parsed.segments;
    }
  });
  if (current.length) sections.push(current);
  return {sections, boundaries};
}

/**
 * Resolve the per-topic canonical subject for one sheet of a split document.
 *
 * @param {string} studioSubject the document title
 * @param {string[]} topicLabels distinct topic labels in document order
 * @return {?object} null when not a split document; otherwise
 *   {byTopic, ambiguous, reason, sectionCount, expected}
 */
function resolveSplitSubjects(studioSubject, topicLabels) {
  const spec = SPLIT_DOCUMENTS[studioSubject];
  if (!spec) return null;

  const {sections} = sectionsByCodeReset(topicLabels);
  const expected = spec.sections.length;
  const base = {
    byTopic: new Map(),
    sectionCount: sections.length,
    expected,
    ambiguous: false,
    reason: "",
  };

  if (sections.length !== expected) {
    return Object.assign({}, base, {
      ambiguous: true,
      reason: `expected ${expected} numbered sections, ` +
        `found ${sections.length}`,
    });
  }

  const byTopic = new Map();
  const conflicting = [];
  sections.forEach((labels, index) => {
    const subject = spec.sections[index];
    for (const label of labels) {
      if (byTopic.has(label) && byTopic.get(label) !== subject) {
        conflicting.push(label);
      } else {
        byTopic.set(label, subject);
      }
    }
  });

  if (conflicting.length) {
    return Object.assign({}, base, {
      ambiguous: true,
      reason: `topic appears in both sections: ${conflicting.join(", ")}`,
    });
  }
  return Object.assign({}, base, {byTopic});
}

const LEGACY_COMBINED_KEYS = Object.freeze(
    Object.values(SPLIT_DOCUMENTS).map((s) => s.legacyKey),
);

module.exports = {
  SPLIT_DOCUMENTS,
  LEGACY_COMBINED_KEYS,
  sectionsByCodeReset,
  resolveSplitSubjects,
};
