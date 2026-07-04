/**
 * schemeTermDivision (server) — divide an ordered syllabus topic list across
 * the three school terms so each term CONTINUES the syllabus instead of
 * restarting it.
 *
 * Lock-step CommonJS copy of src/utils/schemeTermDivision.js (the browser
 * preview). Keep the two in sync. The server uses this so that even when the
 * client sends no explicit topic selection (old client, or the teacher skipped
 * the preview), the prompt outline is still sliced to the requested term —
 * Term 2 never restarts from the first topic.
 *
 * DOM-free / Firestore-free — unit-tested under plain `node`.
 */

const TERMS = [1, 2, 3];

const DEFAULT_SUBTOPICS_PER_WEEK = 2;
const MAX_WEEKS_PER_TOPIC = 4;

/** A topic may arrive as `{topic}` (outline) or `{label}` (client shape). */
function topicName(t) {
  return String((t && (t.topic != null ? t.topic : t.label)) || "").trim();
}

/** Flatten a sub-topic (plain string OR `{name}` object) to its name. */
function subtopicName(s) {
  if (s == null) return "";
  if (typeof s === "string") return s.trim();
  if (typeof s === "object" && typeof s.name === "string") return s.name.trim();
  return String(s).trim();
}

function cleanSubtopics(t) {
  const raw = Array.isArray(t && t.subtopics) ? t.subtopics : [];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const name = subtopicName(s);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Estimate the teaching weeks a topic needs from its sub-topic count. */
function estimateTopicWeeks(topic, opts = {}) {
  const per = Math.max(1, opts.subtopicsPerWeek || DEFAULT_SUBTOPICS_PER_WEEK);
  const cap = Math.max(1, opts.maxWeeksPerTopic || MAX_WEEKS_PER_TOPIC);
  const n = cleanSubtopics(topic).length;
  if (n <= 1) return 1;
  return Math.min(cap, Math.ceil(n / per));
}

function normalizeWeeksByTerm(weeksByTerm) {
  const w = weeksByTerm || {};
  const val = (t, def) => {
    const n = Number(w[t]);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : def;
  };
  return {1: val(1, 12), 2: val(2, 12), 3: val(3, 11)};
}

function toDivisionItems(topics, opts = {}) {
  return (Array.isArray(topics) ? topics : [])
      .map((t, i) => ({raw: t, i}))
      .filter(({raw}) => topicName(raw))
      .map(({raw, i}) => ({
        index: i,
        topic: topicName(raw),
        subtopics: cleanSubtopics(raw),
        specificOutcomes: Array.isArray(raw.specificOutcomes) ?
          raw.specificOutcomes : [],
        keyCompetencies: Array.isArray(raw.keyCompetencies) ?
          raw.keyCompetencies : [],
        suggestedMaterials: Array.isArray(raw.suggestedMaterials) ?
          raw.suggestedMaterials : [],
        weeks: estimateTopicWeeks(raw, opts),
        source: String((raw && raw.source) || "syllabi_studio"),
      }));
}

/**
 * Greedy, order-preserving division across Term 1/2/3. Pours topics into
 * Term 1 until its teaching-week budget is met, then Term 2, then Term 3 —
 * so each term continues the syllabus and no topic is repeated or skipped.
 */
function divideTopicsByTerm(topics, opts = {}) {
  const items = toDivisionItems(topics, opts);
  const weeksByTerm = normalizeWeeksByTerm(opts.weeksByTerm);
  const byTerm = {1: [], 2: [], 3: []};

  let ti = 0;
  let usedInTerm = 0;
  for (const item of items) {
    while (
      ti < TERMS.length - 1 &&
      usedInTerm > 0 &&
      usedInTerm + item.weeks > weeksByTerm[TERMS[ti]]
    ) {
      ti += 1;
      usedInTerm = 0;
    }
    byTerm[TERMS[ti]].push(item);
    usedInTerm += item.weeks;
  }

  return {byTerm, items, weeksByTerm};
}

/** The ordered topic slice for a single term (never restarts the syllabus). */
function topicsForTerm(topics, term, opts = {}) {
  const t = Math.min(3, Math.max(1, Number(term) || 1));
  return divideTopicsByTerm(topics, opts).byTerm[t] || [];
}

/**
 * Slice a resolved scheme outline down to one term. Returns a NEW outline
 * object with `topics`/`topicCount`/`subtopicCount` limited to the term's
 * slice, so renderOutlineBlock() emits only that term's topics. When the
 * outline has no topics (AI-inferred path) it is returned unchanged.
 */
function sliceOutlineToTerm(outline, term, opts = {}) {
  if (!outline || !Array.isArray(outline.topics) || outline.topics.length === 0) {
    return outline;
  }
  const slice = topicsForTerm(outline.topics, term, opts);
  const keep = new Set(slice.map((it) => it.index));
  const topics = outline.topics.filter((_, i) => keep.has(i));
  const subtopicCount = topics.reduce(
      (n, t) => n + (Array.isArray(t.subtopics) ? t.subtopics.length : 0), 0);
  return {
    ...outline,
    topics,
    topicCount: topics.length,
    subtopicCount,
    // Preserve which term this slice represents for downstream provenance.
    term: Number(term) || undefined,
  };
}

module.exports = {
  TERMS,
  topicName,
  subtopicName,
  estimateTopicWeeks,
  toDivisionItems,
  divideTopicsByTerm,
  topicsForTerm,
  sliceOutlineToTerm,
};
