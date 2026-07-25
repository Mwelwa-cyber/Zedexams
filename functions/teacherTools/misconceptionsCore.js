/**
 * misconceptionsCore — the pure half of the per-topic misconception store (§3.3).
 *
 * "MCQ distractors must be drawn from plausible learner misconceptions for that
 * topic and grade, not from arbitrary wrong values."
 *
 * The generator already asks the model to explain each wrong option
 * (`distractorRationale`), and that explanation is exactly the raw material a
 * misconception store is made of — it was being written onto each paper and then
 * forgotten. This harvests it: every generated multiple-choice question
 * contributes what its wrong answers were and why a learner would pick them, keyed
 * by grade + subject + topic, and the next paper on that topic is told about them.
 *
 * The store is therefore descriptive, not invented. Nothing here makes up a
 * misconception; it records ones the model already articulated while writing real
 * questions, counts how often each recurs, and keeps the most-seen. A brand-new
 * topic simply has an empty store and the prompt says nothing about it — which is
 * the honest behaviour, and how §3.5 ("never invent syllabus content") applies here.
 *
 * Pure: no firebase, no network. `misconceptions.js` adds the Firestore half.
 */

"use strict";

/** Most misconceptions a single topic's document keeps. */
const MAX_PER_TOPIC = 40;
/** Most fed into a prompt — enough to steer, not enough to crowd the brief. */
const MAX_IN_PROMPT = 12;
/** Longest misconception text kept. */
const MAX_TEXT = 240;

/**
 * The document id for one grade + subject + topic. Deterministic, so the same
 * topic always lands on the same document and the store can be read with a get
 * rather than a query.
 *
 * The topic is slugged rather than hashed so the id is legible in the console —
 * whoever opens this collection to check what the generator "knows" about
 * Photosynthesis should be able to find it.
 */
function misconceptionDocId({framework, grade, subject, topic}) {
  const slug = String(topic || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  return [
    String(framework) === "2013" ? "obc" : "cbc",
    String(grade || "").toUpperCase(),
    String(subject || "").toLowerCase(),
    slug,
  ].join("_");
}

/**
 * The comparison key for "is this the same misconception?".
 *
 * Deliberately crude — lowercase, punctuation and filler words stripped. The
 * alternative is embeddings, which would be better and would also mean a paid
 * call per distractor on every generation. Crude-and-free catches the case that
 * actually happens (the model rephrasing the same error each time), and a
 * near-miss that slips through just sits as a second entry.
 */
function misconceptionKey(text) {
  return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(the|a|an|that|this|they|their|of|to|for|is|are|and|or|as|with|learners?|pupils?|students?|children|confuse[sd]?|think[s]?|believe[s]?|assume[s]?|may|might|often|will|would|because)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
}

/**
 * Split one distractorRationale line into the wrong answer it explains and the
 * error itself.
 *
 * The prompt asks for "Root: learners confuse water uptake with food making", so
 * the part before the first colon is the option. A line with no colon is still
 * useful — it is the error without the label — so it is kept rather than dropped.
 */
function parseRationale(line) {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const colon = raw.indexOf(":");
  // A colon at the very start, or so late that what follows is a fragment, is
  // punctuation rather than a label.
  if (colon > 0 && colon < 60 && raw.length - colon > 8) {
    return {
      wrongAnswer: raw.slice(0, colon).trim().slice(0, 120),
      text: raw.slice(colon + 1).trim().slice(0, MAX_TEXT),
    };
  }
  return {wrongAnswer: "", text: raw.slice(0, MAX_TEXT)};
}

/**
 * Pull every misconception out of a validated assessment, grouped by topic.
 *
 * Only multiple-choice and true/false questions carry distractors, and only a
 * question tagged with a topic can be filed under one — an untagged question's
 * rationale has nowhere to go, so it is skipped rather than filed under a guess.
 *
 * @param {object} assessment a validated assessment (validateAssessment output)
 * @returns {object} topic → [{text, wrongAnswer}]
 */
function harvestMisconceptions(assessment) {
  const byTopic = {};
  const sections = assessment && Array.isArray(assessment.sections) ?
    assessment.sections : [];
  for (const section of sections) {
    const questions = Array.isArray(section.questions) ? section.questions : [];
    for (const question of questions) {
      const topic = String(question.topic || "").trim();
      if (!topic) continue;
      const rationales = Array.isArray(question.distractorRationale) ?
        question.distractorRationale : [];
      if (rationales.length === 0) continue;
      for (const line of rationales) {
        const parsed = parseRationale(line);
        if (!parsed || !parsed.text) continue;
        // A rationale explaining the CORRECT option is not a misconception. The
        // prompt asks for wrong options only, but a model that lines them up with
        // every option leaves a blank or a "correct" note in the right slot.
        if (/^\s*(correct|right|this is the answer)\b/i.test(parsed.text)) continue;
        if (!byTopic[topic]) byTopic[topic] = [];
        byTopic[topic].push(parsed);
      }
    }
  }
  return byTopic;
}

/**
 * Merge freshly harvested misconceptions into a stored document's list.
 *
 * A repeat sighting increments `seen` rather than adding a row — that count is
 * what makes the store useful, because a misconception three papers in a row hit
 * is more worth designing a distractor around than one that appeared once.
 *
 * @param {object[]} existing the stored list (may be undefined)
 * @param {object[]} fresh    harvested {text, wrongAnswer}
 * @param {string} at         ISO timestamp, passed in so this stays pure
 * @returns {{items: object[], added: number, updated: number}}
 */
function mergeMisconceptions(existing, fresh, at = "") {
  const items = (Array.isArray(existing) ? existing : [])
      .filter((m) => m && typeof m === "object" && m.text)
      .map((m) => ({
        text: String(m.text).slice(0, MAX_TEXT),
        wrongAnswer: String(m.wrongAnswer || "").slice(0, 120),
        seen: Number(m.seen) > 0 ? Math.round(Number(m.seen)) : 1,
        firstSeenAt: m.firstSeenAt || at || null,
        lastSeenAt: m.lastSeenAt || at || null,
      }));
  const byKey = new Map();
  for (const item of items) {
    const key = misconceptionKey(item.text);
    if (!key) continue;
    // A stored document could already contain two near-duplicates (written before
    // this merge existed). Fold them rather than preserving the duplication.
    const seen = byKey.get(key);
    if (seen) {
      seen.seen += item.seen;
      continue;
    }
    byKey.set(key, item);
  }

  let added = 0;
  let updated = 0;
  for (const candidate of Array.isArray(fresh) ? fresh : []) {
    const text = String(candidate && candidate.text || "").trim().slice(0, MAX_TEXT);
    const key = misconceptionKey(text);
    if (!key) continue;
    const found = byKey.get(key);
    if (found) {
      found.seen += 1;
      found.lastSeenAt = at || found.lastSeenAt;
      // A later sighting that names the wrong answer fills in one that did not.
      if (!found.wrongAnswer && candidate.wrongAnswer) {
        found.wrongAnswer = String(candidate.wrongAnswer).slice(0, 120);
      }
      updated += 1;
      continue;
    }
    byKey.set(key, {
      text,
      wrongAnswer: String(candidate.wrongAnswer || "").slice(0, 120),
      seen: 1,
      firstSeenAt: at || null,
      lastSeenAt: at || null,
    });
    added += 1;
  }

  // Most-seen first, then most recent, then alphabetical so the order is stable
  // across runs (a churning array would make every write look like a change).
  const merged = [...byKey.values()].sort((a, b) => (
    b.seen - a.seen ||
    String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")) ||
    a.text.localeCompare(b.text)
  ));
  return {items: merged.slice(0, MAX_PER_TOPIC), added, updated};
}

/**
 * Render what is known about the chosen topics' misconceptions as prompt text.
 *
 * Phrased as material to draw on, never as a requirement: a paper whose questions
 * happen not to suit any recorded misconception must not be forced to use one.
 * Returns "" when nothing is known, so a fresh topic adds nothing to the prompt
 * rather than a paragraph saying there is nothing to say.
 *
 * @param {object} byTopic topic → stored items
 */
function buildMisconceptionDirective(byTopic) {
  const topics = Object.keys(byTopic || {})
      .filter((t) => Array.isArray(byTopic[t]) && byTopic[t].length > 0);
  if (topics.length === 0) return "";

  const lines = [];
  lines.push(
      "KNOWN LEARNER MISCONCEPTIONS — mistakes learners at this level have " +
    "actually made on these topics, recorded from earlier papers. Where a " +
    "multiple-choice question suits one, build a wrong option around it instead " +
    "of inventing a value nobody would choose, and say so in " +
    "\"distractorRationale\". Do not force one in where it does not fit, and do " +
    "not reuse the wording below verbatim.",
  );
  for (const topic of topics) {
    const items = byTopic[topic].slice(0, MAX_IN_PROMPT);
    lines.push("");
    lines.push(`${topic}:`);
    for (const item of items) {
      const seen = Number(item.seen) > 1 ? ` (seen ${item.seen}×)` : "";
      lines.push(item.wrongAnswer ?
        `  - picks "${item.wrongAnswer}" because ${item.text}${seen}` :
        `  - ${item.text}${seen}`);
    }
  }
  return lines.join("\n");
}

module.exports = {
  MAX_PER_TOPIC,
  MAX_IN_PROMPT,
  misconceptionDocId,
  misconceptionKey,
  parseRationale,
  harvestMisconceptions,
  mergeMisconceptions,
  buildMisconceptionDirective,
};
