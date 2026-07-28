/**
 * The ONE way server code resolves a lesson plan by id.
 *
 * ## The failure this exists to end
 *
 * Three server paths read `aiGenerations/{lessonPlanId}` directly and took
 * `output || data`: the download endpoint, the notes generator, and the
 * template-bank trigger. Once the rendered copy moved to `teacherLibraryItems`,
 * every one of them would have kept working — and served the RAW MODEL OUTPUT
 * instead of the teacher's edited plan. No error, no warning, no failing test.
 * A teacher edits a plan, downloads it, and gets the version they rejected.
 *
 * That is the same shape as every other bug in this phase: a path that looks
 * healthy from every angle except the one that matters.
 *
 * ## Resolution order, and why the fallback is narrow
 *
 * 1. `teacherLibraryItems/{id}` — the teacher's edited artefact, if it exists.
 * 2. `aiGenerations/{id}` — legacy plans saved before the split, and plans
 *    generated but never saved to the library.
 *
 * The fallback fires ONLY when the library item is absent. If it exists but
 * belongs to someone else this throws permission-denied and does NOT fall
 * through — falling through would turn "you may not read this teacher's edited
 * plan" into "here is the underlying generation instead", which is the same
 * data one revision earlier. Fail closed.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

/** Where a resolved artefact came from. Callers that persist a decision — a
 * download ticket, say — must record this, or a later re-resolution can land
 * somewhere else. */
const ARTIFACT_SOURCES = Object.freeze({
  libraryItem: "teacher_library_item",
  legacyGeneration: "legacy_generation",
});

/**
 * Which storage shape an aiGenerations document is in.
 *
 * `record.data || record.output` reads like a sensible default and is not one.
 * It quietly makes `data` an unofficial override on canonical operation
 * records — so the day something writes `data` onto one, every reader silently
 * switches to it and nothing says why. The shape is identified positively
 * instead, and an unrecognised one fails closed.
 *
 *   legacy studio snapshot   `data`, no `output`   → the teacher's edited plan
 *   canonical operation      `output`, no `data`   → what the model returned
 *   canonical + artefact     `output` AND any of data/html/studioFormat →
 *                            an INVARIANT FAILURE: the whole point of the
 *                            split is that rendered artefacts never land on
 *                            the operation record.
 *   both data and output     ambiguous → refuse rather than guess
 */
function classifyGenerationShape(record = {}) {
  const hasOutput = record.output !== undefined && record.output !== null;
  const hasData = record.data !== undefined && record.data !== null;
  const hasArtifactFields = hasData ||
    record.html !== undefined || record.studioFormat !== undefined;

  if (hasOutput && hasArtifactFields) return "canonical_with_artifact_fields";
  if (hasOutput) return "canonical_operation";
  if (hasData) return "legacy_studio_snapshot";
  return "unknown";
}

/** The plan a generation record holds, or a refusal. */
function planFromGeneration(record, id) {
  const shape = classifyGenerationShape(record);
  if (shape === "legacy_studio_snapshot") return record.data;
  if (shape === "canonical_operation") return record.output;
  if (shape === "canonical_with_artifact_fields") {
    throw new HttpsError("failed-precondition",
        "The lesson-plan record has an ambiguous storage shape.",
        {code: "ARTIFACT_FIELDS_ON_OPERATION_RECORD", lessonPlanId: id});
  }
  throw new HttpsError("failed-precondition",
      "The lesson-plan record has an ambiguous storage shape.",
      {code: "UNRECOGNISED_GENERATION_SHAPE", lessonPlanId: id});
}

/**
 * @param {Object} args
 * @param {string} args.uid            Authenticated caller. Ownership is checked
 *                                     against the document, never assumed.
 * @param {string} args.lessonPlanId   The library item id, which for an
 *                                     AI-generated plan is also the generation
 *                                     id (they are the same value by design).
 * @returns {Promise<Object|null>} null when neither document exists.
 */
async function resolveLessonPlanArtifact({uid, lessonPlanId}) {
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const id = String(lessonPlanId || "").trim();
  if (!id) throw new HttpsError("invalid-argument", "A lesson plan id is required.");

  const db = admin.firestore();

  const itemSnap = await db.collection("teacherLibraryItems").doc(id).get();
  if (itemSnap.exists) {
    const item = itemSnap.data();
    if (item.ownerUid !== uid) {
      // Deliberately NOT a fallback. See the header.
      throw new HttpsError("permission-denied", "This lesson plan belongs to another teacher.");
    }
    return {
      artifactSource: ARTIFACT_SOURCES.libraryItem,
      artifactId: id,
      libraryItemId: id,
      sourceGenerationId: item.sourceGenerationId || null,
      ownerUid: item.ownerUid,
      plan: item.data || null,
      html: item.html || "",
      meta: item.meta || {},
      inputs: item.inputs || {},
      studioFormat: item.studioFormat || "modern",
    };
  }

  const genSnap = await db.collection("aiGenerations").doc(id).get();
  if (!genSnap.exists) return null;
  const gen = genSnap.data();
  if (gen.ownerUid !== uid) {
    throw new HttpsError("permission-denied", "This lesson plan belongs to another teacher.");
  }
  return {
    artifactSource: ARTIFACT_SOURCES.legacyGeneration,
    artifactId: id,
    libraryItemId: null,
    sourceGenerationId: id,
    ownerUid: gen.ownerUid,
    plan: planFromGeneration(gen, id),
    html: gen.html || "",
    meta: gen.meta || {},
    inputs: gen.inputs || {},
    studioFormat: gen.studioFormat || "modern",
  };
}

/**
 * Re-read an artefact from a PINNED source, refusing to look anywhere else.
 *
 * A two-stage flow — issue a download ticket, redeem it moments later — must
 * not re-run the resolver at redemption. If the library item were deleted in
 * between, the resolver would fall back to the operation record and hand over
 * the raw model output under a ticket the teacher was issued for their edited
 * plan. The ticket records what it resolved; this reads exactly that.
 */
async function readPinnedArtifact({uid, artifactId, artifactSource}) {
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const collection = artifactSource === ARTIFACT_SOURCES.libraryItem ?
    "teacherLibraryItems" :
    artifactSource === ARTIFACT_SOURCES.legacyGeneration ? "aiGenerations" : null;
  if (!collection) {
    throw new HttpsError("invalid-argument", `Unknown artifact source: ${artifactSource}`);
  }

  const snap = await admin.firestore().collection(collection).doc(String(artifactId)).get();
  if (!snap.exists) {
    // The pinned document is gone. An error is the honest answer; the other
    // source holds different content, and the teacher asked for this one.
    throw new HttpsError("not-found",
        "This lesson plan is no longer available. Please open it again to download.");
  }
  const doc = snap.data();
  if (doc.ownerUid !== uid) {
    throw new HttpsError("permission-denied", "This lesson plan belongs to another teacher.");
  }
  return {
    artifactSource,
    artifactId: String(artifactId),
    libraryItemId: artifactSource === ARTIFACT_SOURCES.libraryItem ? String(artifactId) : null,
    sourceGenerationId: artifactSource === ARTIFACT_SOURCES.libraryItem ?
      (doc.sourceGenerationId || null) : String(artifactId),
    ownerUid: doc.ownerUid,
    plan: artifactSource === ARTIFACT_SOURCES.libraryItem ?
      (doc.data || null) : planFromGeneration(doc, artifactId),
    html: doc.html || "",
    meta: doc.meta || {},
    inputs: doc.inputs || {},
    studioFormat: doc.studioFormat || "modern",
  };
}

module.exports = {
  ARTIFACT_SOURCES,
  classifyGenerationShape,
  planFromGeneration,
  resolveLessonPlanArtifact,
  readPinnedArtifact,
};
