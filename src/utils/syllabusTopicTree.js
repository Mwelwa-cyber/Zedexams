/**
 * Syllabus topic hierarchy — restore the two-level TOPIC → SUB-TOPIC tree that
 * the source PDFs encode in their numbering but that the ingestion flattens.
 *
 * The CDC syllabus workbooks merge the TOPIC cell across every row belonging to
 * one topic. At a PDF page break that merge is lost, so the first row of the new
 * page puts a SUB-TOPIC code — or a fragment of outcome prose — into the TOPIC
 * column. The extractors propagate whatever they find there forward, which is
 * how Grade 7 Integrated Science ends up offering
 *
 *     7.4.0 Plants and Animals      ← the real topic
 *     7.4.3 Fruits and seeds        ← its sub-topic, promoted to a topic
 *     7.4.4 Seed dispersal          ← ditto
 *     7.4.5 Propagation             ← ditto
 *
 * as four sibling checkboxes in one flat list, leaving the "Sub-topics" picker
 * empty because the parent lost its children.
 *
 * The numbering itself carries the hierarchy and is currently unused, so that
 * is what we key off — NOT text heuristics over curriculum content:
 *
 *   • A code's KEY is its segments with trailing zeros stripped, so the topic
 *     "7.4.0" and the sub-topic prefix "7.4" are the same node.
 *   • An entry is a CHILD when its parent key matches the key of another entry
 *     ("7.4.3" → parent "7.4" → the node "7.4.0" owns it).
 *   • An entry whose parent key matches nothing is a TOPIC and is kept as-is —
 *     which is why the 2023 catalogue ("4.4 PLANT AND ANIMALS", parent "4",
 *     no such node) passes through untouched.
 *
 * Fragments — a TOPIC cell holding a scrap of the previous row's prose rather
 * than a heading — are folded back into the topic they were split from. This
 * only runs on catalogues that are predominantly numbered, so a legitimately
 * code-free sheet (ECE strand names) is never collapsed.
 *
 * NOTHING here edits curriculum content: titles are preserved verbatim, and a
 * demoted topic becomes a sub-topic under its parent rather than being dropped.
 * Pure (no React, no Firebase, no I/O) and mirrored server-side in
 * functions/teacherTools/syllabusTopicTree.js — keep the two in lock-step
 * (guarded by scripts/test-syllabus-topic-tree.mjs).
 */

// A leading dotted-numeric code: "7.4.0 Plants and Animals", "4.4 THE HUMAN
// BODY", "1) Introduction". The separator between the code and the title must
// be real whitespace so an outcome reference glued to its text
// ("7.5.6.1Identify types of metals") is not mistaken for a heading.
const TOPIC_CODE_RE = /^\s*(\d+(?:\.\d+)*)\s*[.)]?\s+(\S.*)$/
// A code with no title at all ("7.4.0") — still a valid heading cell.
const BARE_CODE_RE = /^\s*(\d+(?:\.\d+)*)\s*[.)]?\s*$/
// A leading code whose own dots were spaced apart during extraction:
// "11. 10 Food allergies" is topic 11.10, not topic 11 titled "10 Food
// allergies". Left unrepaired it invents a phantom "11" node that then adopts
// every real 11.x topic on the sheet as a sub-topic.
const SPACED_CODE_RE = /^\d+(?:\s*\.\s*\d+)+/

/** Close the gaps inside a leading dotted code, leaving the title untouched. */
function repairCodeSpacing(raw) {
  return raw.replace(SPACED_CODE_RE, (code) => code.replace(/\s+/g, ''))
}

/**
 * Parse a topic label into its numbering + title.
 *
 * @param {string} label
 * @returns {{code:string, segments:number[], key:string, parentKey:string, title:string}|null}
 *   null when the label carries no leading code.
 */
export function parseTopicCode(label) {
  const raw = repairCodeSpacing(String(label ?? '').trim())
  if (!raw) return null
  const m = TOPIC_CODE_RE.exec(raw) || BARE_CODE_RE.exec(raw)
  if (!m) return null
  const code = m[1]
  const title = (m[2] ?? '').trim()
  const segments = code.split('.').map((n) => Number(n))
  if (segments.some((n) => !Number.isInteger(n))) return null
  const keySegments = stripTrailingZeros(segments)
  return {
    code,
    segments,
    title,
    key: keySegments.join('.'),
    parentKey: keySegments.slice(0, -1).join('.'),
  }
}

/** [7,4,0] → [7,4]; [7,4,3] → [7,4,3]; [0] → [0] (never empties the key). */
function stripTrailingZeros(segments) {
  const out = segments.slice()
  while (out.length > 1 && out[out.length - 1] === 0) out.pop()
  return out
}

/**
 * True when an un-numbered TOPIC cell is a scrap of the previous row rather
 * than a heading. Deliberately narrow — a real heading never opens in
 * lower case, and never carries a fully-qualified outcome reference inside it.
 */
export function looksLikeTopicFragment(label) {
  const raw = String(label ?? '').trim()
  if (!raw) return true
  if (parseTopicCode(raw)) return false
  // "and Non-metals" — a heading never opens in lower case.
  if (/^[a-z]/.test(raw)) return true
  // An outcome reference that PROSE runs into ("food. 7.2.2.3 State the
  // importance of fruits …"). The code must be preceded by words, not merely
  // present: "3-4.1.1. SELECTED PRESCRIBED TEXT" is a real Form 3-4 heading
  // whose code simply does not parse, and dropping it would lose the topic.
  const codeAt = raw.search(/\d+\.\d+\.\d+/)
  if (codeAt > 0 && /[A-Za-z]/.test(raw.slice(0, codeAt))) return true
  return false
}

// Below this share of numbered entries a catalogue is treated as un-numbered
// (ECE / Lower Primary strand sheets), and fragment folding is skipped so a
// code-free sheet can never collapse into its first entry.
const NUMBERED_SHARE_FOR_FRAGMENT_FOLDING = 0.6

/**
 * Restore the topic → sub-topic tree for ONE grade+subject.
 *
 * @param {Map<string, Set<string>|string[]>} inner  topic → its sub-topics
 * @returns {{topics: Map<string, Set<string>>, demoted: Array, folded: Array}}
 *   `topics` is a fresh Map in the original topic order. `demoted` lists the
 *   sub-topics that had been masquerading as topics and `folded` the fragments
 *   that were re-absorbed — both purely so the validation report can name them.
 */
export function normalizeTopicTree(inner) {
  const entries = []
  for (const [topic, subs] of inner instanceof Map ? inner : new Map(Object.entries(inner || {}))) {
    entries.push({
      topic: String(topic),
      subs: Array.from(subs || []),
      parsed: parseTopicCode(topic),
    })
  }

  const numbered = entries.filter((e) => e.parsed).length
  const foldFragments = entries.length > 0 &&
    numbered / entries.length >= NUMBERED_SHARE_FOR_FRAGMENT_FOLDING

  // Every key that a numbered entry occupies — the set a parent lookup resolves
  // against. Built up front so ordering within the sheet never matters.
  const keys = new Set()
  for (const e of entries) if (e.parsed) keys.add(e.parsed.key)

  const topics = new Map()
  const demoted = []
  const folded = []
  // The most recent entry kept as a topic — where a fragment's sub-topics and a
  // demoted entry's sub-topics get re-attached when their own parent is gone.
  let lastKeptKey = null

  const addSub = (topicName, value) => {
    const set = topics.get(topicName)
    if (!set) return
    const clean = String(value ?? '').trim()
    if (clean) set.add(clean)
  }

  // Resolve a demoted entry to the nearest ANCESTOR that is itself a topic, so
  // a three-deep leak ("7.4.3.1" under "7.4.3" under "7.4.0") lands on the real
  // topic rather than on another demoted node.
  const nearestTopicName = (parsed) => {
    let parent = parsed.parentKey
    while (parent) {
      const owner = entries.find((e) => e.parsed && e.parsed.key === parent && topics.has(e.topic))
      if (owner) return owner.topic
      parent = parent.split('.').slice(0, -1).join('.')
    }
    return null
  }

  // Pass 1 — keep the genuine topics, in their original order.
  for (const e of entries) {
    if (e.parsed && e.parsed.parentKey && keys.has(e.parsed.parentKey)) continue // a child
    if (!e.parsed && foldFragments && looksLikeTopicFragment(e.topic)) continue  // a fragment
    topics.set(e.topic, new Set(e.subs.map((s) => String(s ?? '').trim()).filter(Boolean)))
  }

  // Pass 2 — re-attach everything that was not kept.
  for (const e of entries) {
    if (topics.has(e.topic)) { lastKeptKey = e.topic; continue }
    if (e.parsed) {
      const parentName = nearestTopicName(e.parsed) || lastKeptKey
      if (!parentName) { topics.set(e.topic, new Set(e.subs)); lastKeptKey = e.topic; continue }
      // The demoted heading becomes a sub-topic of its parent, carrying its own
      // sub-topics up alongside it — no curriculum content is lost.
      addSub(parentName, e.topic)
      for (const s of e.subs) addSub(parentName, s)
      demoted.push({ topic: e.topic, parent: parentName })
    } else {
      // A fragment: its sub-topics belong to the topic it was split from.
      if (!lastKeptKey) continue
      for (const s of e.subs) addSub(lastKeptKey, s)
      folded.push({ fragment: e.topic, parent: lastKeptKey })
    }
  }

  return { topics, demoted, folded }
}

/**
 * Apply normalizeTopicTree across a whole "GRADE|subject" → Map<topic, Set>
 * lookup, in place of the caller rebuilding one. Returns a NEW outer Map.
 */
export function normalizeTopicLookup(lookup) {
  const out = new Map()
  for (const [key, inner] of lookup instanceof Map ? lookup : new Map()) {
    out.set(key, normalizeTopicTree(inner).topics)
  }
  return out
}
