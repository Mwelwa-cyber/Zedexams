/**
 * misconceptions — the Firestore half of the per-topic misconception store (§3.3).
 *
 * Reads what is known about a topic's learner misconceptions before a paper is
 * written, and records what the new paper articulated afterwards. Both directions
 * are BEST-EFFORT: a paper must never fail to generate because this collection was
 * unreadable, and must never fail to be delivered because the harvest could not be
 * written. So every function here swallows its errors and logs them.
 *
 * All decisions (ids, dedup, merge, prompt text) live in misconceptionsCore.js so
 * they test under plain `node`.
 *
 * Collection: topicMisconceptions/{cbc|obc}_{GRADE}_{subject}_{topic-slug}
 * Server-only in firestore.rules — nothing client-side reads or writes it.
 */

const admin = require("firebase-admin");
const {
  misconceptionDocId, harvestMisconceptions, mergeMisconceptions,
  buildMisconceptionDirective,
} = require("./misconceptionsCore");

const COLLECTION = "topicMisconceptions";
/** Most topics read per generation, so a 12-topic mock cannot fan out unbounded. */
const MAX_TOPICS_READ = 8;

/**
 * What is known about these topics' misconceptions.
 *
 * @returns {Promise<object>} topic → items (empty object when nothing is known
 *   or the read failed — the caller cannot tell the difference, and must not
 *   need to: both mean "say nothing about misconceptions in the prompt")
 */
async function loadMisconceptions({framework, grade, subject, topics = []}) {
  const wanted = topics
      .map((t) => String(t || "").trim())
      .filter(Boolean)
      .slice(0, MAX_TOPICS_READ);
  if (wanted.length === 0) return {};
  try {
    const db = admin.firestore();
    const refs = wanted.map((topic) => db.collection(COLLECTION)
        .doc(misconceptionDocId({framework, grade, subject, topic})));
    const snaps = await db.getAll(...refs);
    const out = {};
    snaps.forEach((snap, i) => {
      if (!snap.exists) return;
      const data = snap.data() || {};
      const items = Array.isArray(data.misconceptions) ? data.misconceptions : [];
      if (items.length > 0) out[wanted[i]] = items;
    });
    return out;
  } catch (err) {
    // A misconception store we cannot read is a missed improvement, not a failure:
    // the paper generates exactly as it did before this feature existed.
    console.warn("[misconceptions] load failed", {grade, subject}, err);
    return {};
  }
}

/**
 * The prompt text for what is known about these topics. "" when nothing is.
 */
async function buildMisconceptionContext({framework, grade, subject, topics}) {
  const byTopic = await loadMisconceptions({framework, grade, subject, topics});
  return buildMisconceptionDirective(byTopic);
}

/**
 * Record what a freshly generated paper articulated about learner errors.
 *
 * One transaction per topic rather than one for the whole paper: the topics are
 * independent documents, a contended retry on one should not roll back the others,
 * and a paper covering eight topics writing eight small transactions is cheaper
 * than one transaction touching eight documents.
 *
 * @returns {Promise<{topics: number, added: number, updated: number}>}
 */
async function recordMisconceptions({framework, grade, subject, assessment}) {
  const byTopic = harvestMisconceptions(assessment);
  const topics = Object.keys(byTopic).slice(0, MAX_TOPICS_READ);
  if (topics.length === 0) return {topics: 0, added: 0, updated: 0};

  const db = admin.firestore();
  const at = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let written = 0;

  await Promise.all(topics.map(async (topic) => {
    const ref = db.collection(COLLECTION)
        .doc(misconceptionDocId({framework, grade, subject, topic}));
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ?
          (snap.data() || {}).misconceptions : [];
        const merged = mergeMisconceptions(existing, byTopic[topic], at);
        // Nothing new and nothing re-seen — do not write, so an unchanged store
        // does not churn updatedAt on every generation.
        if (merged.added === 0 && merged.updated === 0) return;
        tx.set(ref, {
          framework: String(framework) === "2013" ? "obc" : "cbc",
          grade: String(grade || "").toUpperCase(),
          subject: String(subject || "").toLowerCase(),
          topic,
          misconceptions: merged.items,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        added += merged.added;
        updated += merged.updated;
        written += 1;
      });
    } catch (err) {
      // The teacher already has their paper. A failed harvest costs us a future
      // improvement, nothing more — but it must be visible in the logs.
      console.warn("[misconceptions] record failed",
          {grade, subject, topic}, err);
    }
  }));

  return {topics: written, added, updated};
}

module.exports = {
  COLLECTION,
  loadMisconceptions,
  buildMisconceptionContext,
  recordMisconceptions,
};
