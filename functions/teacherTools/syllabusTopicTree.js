/**
 * Syllabus topic hierarchy — server mirror of src/utils/syllabusTopicTree.js.
 *
 * functions/ is a separate CommonJS package and cannot import the browser ESM
 * module, so this is a straight port. The two MUST stay in lock-step: the
 * picker offers the teacher a topic list, and resolveCbcContext grounds the
 * generator on the same hierarchy — if they diverge, a teacher picks a topic
 * the AI's curriculum module doesn't have. Guarded by
 * scripts/test-syllabus-topic-tree.mjs, which runs both implementations over
 * the same fixtures and asserts identical output.
 *
 * See the ESM copy for the full rationale; the short version is that the CDC
 * workbooks lose their merged TOPIC cell at PDF page breaks, so sub-topic codes
 * ("7.4.3 Fruits and seeds") and scraps of outcome prose land in the topic
 * column and surface as sibling topics. The dotted numbering already encodes
 * the real hierarchy, so that is what we key off — never text heuristics over
 * curriculum content, and never by discarding a heading: a demoted topic
 * becomes a sub-topic of its parent.
 */

const TOPIC_CODE_RE = /^\s*(\d+(?:\.\d+)*)\s*[.)]?\s+(\S.*)$/;
const BARE_CODE_RE = /^\s*(\d+(?:\.\d+)*)\s*[.)]?\s*$/;
const SPACED_CODE_RE = /^\d+(?:\s*\.\s*\d+)+/;

/** Close the gaps inside a leading dotted code, leaving the title untouched. */
function repairCodeSpacing(raw) {
  return raw.replace(SPACED_CODE_RE, (code) => code.replace(/\s+/g, ""));
}

/** [7,4,0] → [7,4]; [7,4,3] → [7,4,3]; [0] → [0] (never empties the key). */
function stripTrailingZeros(segments) {
  const out = segments.slice();
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

/**
 * Parse a topic label into its numbering + title.
 * @param {string} label
 * @returns {{code:string, segments:number[], key:string, parentKey:string,
 *            title:string}|null} null when the label carries no leading code.
 */
function parseTopicCode(label) {
  const raw = repairCodeSpacing(String(label == null ? "" : label).trim());
  if (!raw) return null;
  const m = TOPIC_CODE_RE.exec(raw) || BARE_CODE_RE.exec(raw);
  if (!m) return null;
  const code = m[1];
  const title = (m[2] || "").trim();
  const segments = code.split(".").map((n) => Number(n));
  if (segments.some((n) => !Number.isInteger(n))) return null;
  const keySegments = stripTrailingZeros(segments);
  return {
    code,
    segments,
    title,
    key: keySegments.join("."),
    parentKey: keySegments.slice(0, -1).join("."),
  };
}

/**
 * True when an un-numbered TOPIC cell is a scrap of the previous row rather
 * than a heading. Deliberately narrow — a real heading never opens in lower
 * case, and never carries a fully-qualified outcome reference inside it.
 */
function looksLikeTopicFragment(label) {
  const raw = String(label == null ? "" : label).trim();
  if (!raw) return true;
  if (parseTopicCode(raw)) return false;
  if (/^[a-z]/.test(raw)) return true;
  // The code must be preceded by prose, not merely present:
  // "3-4.1.1. SELECTED PRESCRIBED TEXT" is a real Form 3-4 heading whose code
  // simply does not parse, and dropping it would lose the topic.
  const codeAt = raw.search(/\d+\.\d+\.\d+/);
  if (codeAt > 0 && /[A-Za-z]/.test(raw.slice(0, codeAt))) return true;
  return false;
}

const NUMBERED_SHARE_FOR_FRAGMENT_FOLDING = 0.6;

/**
 * Restore the topic → sub-topic tree for ONE grade+subject.
 *
 * @param {Map<string, Set<string>|string[]>} inner topic → its sub-topics
 * @returns {{topics: Map<string, Set<string>>, demoted: Array, folded: Array}}
 */
function normalizeTopicTree(inner) {
  const source = inner instanceof Map ?
    inner : new Map(Object.entries(inner || {}));
  const entries = [];
  for (const [topic, subs] of source) {
    entries.push({
      topic: String(topic),
      subs: Array.from(subs || []),
      parsed: parseTopicCode(topic),
    });
  }

  const numbered = entries.filter((e) => e.parsed).length;
  const foldFragments = entries.length > 0 &&
    numbered / entries.length >= NUMBERED_SHARE_FOR_FRAGMENT_FOLDING;

  const keys = new Set();
  for (const e of entries) if (e.parsed) keys.add(e.parsed.key);

  const topics = new Map();
  const demoted = [];
  const folded = [];
  let lastKeptKey = null;

  const addSub = (topicName, value) => {
    const set = topics.get(topicName);
    if (!set) return;
    const clean = String(value == null ? "" : value).trim();
    if (clean) set.add(clean);
  };

  const nearestTopicName = (parsed) => {
    let parent = parsed.parentKey;
    while (parent) {
      const owner = entries.find((e) => e.parsed &&
        e.parsed.key === parent && topics.has(e.topic));
      if (owner) return owner.topic;
      parent = parent.split(".").slice(0, -1).join(".");
    }
    return null;
  };

  // Pass 1 — keep the genuine topics, in their original order.
  for (const e of entries) {
    if (e.parsed && e.parsed.parentKey && keys.has(e.parsed.parentKey)) continue;
    if (!e.parsed && foldFragments && looksLikeTopicFragment(e.topic)) continue;
    topics.set(e.topic, new Set(
        e.subs.map((s) => String(s == null ? "" : s).trim()).filter(Boolean),
    ));
  }

  // Pass 2 — re-attach everything that was not kept.
  for (const e of entries) {
    if (topics.has(e.topic)) {
      lastKeptKey = e.topic;
      continue;
    }
    if (e.parsed) {
      const parentName = nearestTopicName(e.parsed) || lastKeptKey;
      if (!parentName) {
        topics.set(e.topic, new Set(e.subs));
        lastKeptKey = e.topic;
        continue;
      }
      addSub(parentName, e.topic);
      for (const s of e.subs) addSub(parentName, s);
      demoted.push({topic: e.topic, parent: parentName});
    } else {
      if (!lastKeptKey) continue;
      for (const s of e.subs) addSub(lastKeptKey, s);
      folded.push({fragment: e.topic, parent: lastKeptKey});
    }
  }

  return {topics, demoted, folded};
}

/**
 * Apply normalizeTopicTree across a whole "GRADE|subject" → Map<topic, Set>
 * lookup. Returns a NEW outer Map.
 */
function normalizeTopicLookup(lookup) {
  const out = new Map();
  const source = lookup instanceof Map ? lookup : new Map();
  for (const [key, inner] of source) {
    out.set(key, normalizeTopicTree(inner).topics);
  }
  return out;
}

module.exports = {
  parseTopicCode,
  looksLikeTopicFragment,
  normalizeTopicTree,
  normalizeTopicLookup,
};
