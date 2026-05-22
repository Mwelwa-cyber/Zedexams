/**
 * importBuiltInCbcTopics — admin-only one-click migration.
 *
 * Copies every entry from cbcTopics.TOPICS into Firestore under
 * cbcKnowledgeBase/{KB_VERSION}/topics/*. After the import, the admin UI
 * treats them as fully editable rows, so you can fix typos, tweak
 * wording, or override the seed entirely without a code deploy.
 *
 * Idempotent: re-running overwrites existing documents with the latest
 * in-code data. Use with care — re-running will clobber admin edits on
 * any topic that has the same ID as a built-in.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {TOPICS} = require("./cbcTopics");
const {invalidateKbCache} = require("./cbcKnowledge");

const KB_VERSION = "cbc-kb-2026-04-seed";

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 60);
}

function buildTopicId(t) {
  if (t.id) return String(t.id).slice(0, 80);
  const g = slug(t.grade);
  const s = slug(t.subject);
  const topic = slug(t.topic);
  return `${g}-${s}-${topic}`;
}

exports.importBuiltInCbcTopics = onCall(
  {timeoutSeconds: 60, memory: "256MiB"},
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const role = await getUserRole(uid);
    if (role !== "admin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const db = admin.firestore();
    const col = db.collection("cbcKnowledgeBase").doc(KB_VERSION).collection("topics");
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Firestore batched writes max at 500 operations per batch.
    const BATCH_SIZE = 500;
    let written = 0;
    let batch = db.batch();
    let inBatch = 0;

    for (const t of TOPICS) {
      const id = buildTopicId(t);
      if (!id) continue;
      const payload = {
        id,
        grade: String(t.grade || "").toUpperCase(),
        subject: String(t.subject || "").toLowerCase(),
        term: Number(t.term) || 1,
        topic: String(t.topic || "").trim(),
        // Subtopics may be legacy strings or Phase-A enriched
        // {name, specificCompetence, learningActivities, expectedStandard}
        // objects. Preserve objects as-is; coerce primitives to strings.
        subtopics: Array.isArray(t.subtopics) ?
          t.subtopics.map((s) =>
            (s !== null && typeof s === "object") ? s : String(s),
          ) :
          [],
        specificOutcomes: Array.isArray(t.specificOutcomes) ?
          t.specificOutcomes.map(String) : [],
        keyCompetencies: Array.isArray(t.keyCompetencies) ?
          t.keyCompetencies.map(String) : [],
        values: Array.isArray(t.values) ? t.values.map(String) : [],
        suggestedMaterials: Array.isArray(t.suggestedMaterials) ?
          t.suggestedMaterials.map(String) : [],
        origin: "builtin_seed",
        updatedAt: now,
        importedAt: now,
      };
      batch.set(col.doc(id), payload, {merge: true});
      inBatch += 1;
      if (inBatch >= BATCH_SIZE) {
        await batch.commit();
        written += inBatch;
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) {
      await batch.commit();
      written += inBatch;
    }

    // Invalidate the Cloud Functions module-level cache so new generations
    // see the imported data immediately rather than waiting 60s.
    try { invalidateKbCache(); } catch { /* best effort */ }

    return {
      ok: true,
      written,
      totalInCode: TOPICS.length,
      kbVersion: KB_VERSION,
    };
  },
);
