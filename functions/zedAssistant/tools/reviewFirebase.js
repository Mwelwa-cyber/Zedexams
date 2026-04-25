/**
 * Read-only Firebase / Firestore safety review.
 *
 * Reads the deployed firestore.rules + storage.rules from disk (they're
 * bundled in the function source) and returns them so the model can review
 * them inline. Also returns a sample of doc shapes from the most-used
 * collections (quizzes, games, results) so the model can sanity-check
 * fields against rules. NEVER mutates anything.
 *
 * The rule files live two directories above functions/zedAssistant/, but
 * Firebase Functions only deploys the contents of functions/, so we cannot
 * read them at runtime from disk. Instead we expose:
 *   - collection sampling (always available)
 *   - rule-text review path that the user must paste in (the rules file
 *     isn't present in the deployed bundle; we say so honestly)
 */

const admin = require("firebase-admin");

const definition = {
  name: "review_firebase",
  description:
    "Inspect Firestore collections (samples + counts) so the assistant can " +
    "review data shapes for problems. Read-only. Use when the user asks " +
    "to 'check the games area for errors', 'look at quiz collections', " +
    "'review Firebase data shapes'. For Firestore RULES review, ask the " +
    "user to paste the rules text into chat — they aren't bundled in the " +
    "function deploy, so we can't read them here.",
  input_schema: {
    type: "object",
    properties: {
      collection: {
        type: "string",
        enum: [
          "quizzes",
          "games",
          "scores",
          "results",
          "users",
          "leaderboards",
          "daily_challenges",
          "exam_attempts",
          "learner_profiles",
          "zedAssistantTasks",
        ],
        description: "Which collection to sample.",
      },
      sampleSize: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description: "How many docs to sample. Default 3.",
      },
    },
    required: ["collection"],
  },
};

const FIELD_REDACT = new Set([
  "email",
  "phoneNumber",
  "subscriptionPhoneNumber",
  "nrcNumber",
  "proofPath",
  "rawStatusResponse",
  "tokenHash",
]);

function redact(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        return value.toDate().toISOString();
      } catch {
        return "<timestamp>";
      }
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FIELD_REDACT.has(k)) {
        out[k] = "<redacted>";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  if (typeof value === "string" && value.length > 600) {
    return value.slice(0, 600) + "…";
  }
  return value;
}

async function run(input = {}) {
  const collection = String(input.collection || "");
  const sampleSize = Math.max(1, Math.min(10, Number(input.sampleSize) || 3));
  if (!collection) throw new Error("collection is required.");

  let count = null;
  try {
    const c = await admin.firestore().collection(collection).count().get();
    count = c.data().count;
  } catch (err) {
    console.warn("review_firebase count failed", err?.message);
  }

  const snap = await admin.firestore()
    .collection(collection)
    .limit(sampleSize)
    .get();

  const samples = snap.docs.map((d) => ({
    id: d.id,
    fields: redact(d.data() || {}),
  }));

  return {
    collection,
    documentCount: count,
    sampledCount: samples.length,
    samples,
    note:
      "PII fields (email, phone, NRC, proof paths) are redacted. " +
      "If you need rules review, paste firestore.rules into chat.",
  };
}

module.exports = {definition, run};
