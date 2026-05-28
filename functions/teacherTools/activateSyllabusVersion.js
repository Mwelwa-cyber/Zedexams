/**
 * activateSyllabusVersion — admin-only HTTPS callable.
 *
 * Atomically promotes a parsed-and-reviewed draft syllabus to the active
 * source of truth for every studio. Does four things in one call:
 *
 *   1. Copies every doc in cbcKnowledgeBase/{version}/draftTopics into
 *      cbcKnowledgeBase/{version}/topics with merge:true (idempotent —
 *      re-running an activate doesn't duplicate or corrupt anything).
 *   2. For each promoted topic, expands its subtopics[] array into
 *      individual lessons/{subtopicSlug}-t{1|2|3} subcollection docs so
 *      lookupSubtopicModule gets a subtopic_exact hit for any task term
 *      (the parser hardcodes term:1 on topic docs, so we write all three
 *      term variants from the same content to avoid term-mismatch misses).
 *   3. Writes the runtime pointer at cbcKnowledgeBase/_meta to:
 *        {
 *          version,                          // new active version
 *          usePrivateCurriculum: false,      // close the RAG short-circuit
 *          cacheBust: <prev + 1>,            // propagate to warm containers
 *          previousVersion,                  // for one-click rollback
 *          activatedBy, activatedAt, updatedAt
 *        }
 *   4. Locally invalidates the Cloud Function's in-process caches so the
 *      response is observably fresh. Other warm containers pick up the
 *      cacheBust bump within ~10s on their next getActiveKbState() poll.
 *
 * The old version's topics/* docs are left untouched — they're archived
 * by virtue of no longer being pointed to. Phase D's rollback button
 * just flips _meta.version back to previousVersion to restore them.
 *
 * Rules of engagement:
 *  - Refuses if the target version has zero drafts (prevents activating
 *    an empty syllabus by accident).
 *  - Refuses if the version string doesn't look like an obvious KB
 *    version (alphanumeric / dash, 4..80 chars) — keeps stray inputs
 *    out of the pointer.
 *  - Accepts an optional `expectedPreviousVersion` (admin-supplied) so a
 *    second admin can't race-flip away a version we just activated.
 *
 * Returns: { ok, version, previousVersion, promoted, lessonsWritten, cacheBust }.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  invalidateKbCache,
  getActiveKbState,
} = require("./cbcKnowledge");
const {buildModuleId} = require("./curriculumModuleSchema");

const VERSION_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/;

// Firestore hard limit is 500 writes per batch; leave headroom.
const BATCH_WRITE_LIMIT = 480;

/**
 * Flexible batch helper. Accumulates writes and auto-flushes when the
 * per-batch limit is reached so callers don't have to count manually.
 */
function makeBatchWriter(db) {
  let batch = db.batch();
  let count = 0;
  let totalWrites = 0;

  const flush = async () => {
    if (count === 0) return;
    await batch.commit();
    batch = db.batch();
    count = 0;
  };

  const set = async (ref, data, opts) => {
    if (count >= BATCH_WRITE_LIMIT) await flush();
    batch.set(ref, data, opts || {});
    count++;
    totalWrites++;
  };

  const finish = async () => { await flush(); return totalWrites; };

  return {set, finish};
}

/**
 * Pull the subtopic name out of a subtopic entry — handles both the
 * legacy string format and the Phase-A object format.
 */
function subtopicName(s) {
  if (s == null) return "";
  if (typeof s === "string") return s.trim();
  if (typeof s === "object" && typeof s.name === "string") return s.name.trim();
  return "";
}

/**
 * Build lesson docs for all three term variants of a subtopic so any
 * task term gets a subtopic_exact hit. The parser hardcodes term:1 on
 * topic docs regardless of which term's workbook was uploaded, so writing
 * t1/t2/t3 from the same content is the safest way to avoid misses.
 *
 * Only subtopics that carry actual curriculum content are expanded —
 * bare string entries or entries with no outcomes/activities/competence
 * are skipped so we don't create empty lesson docs that fail the
 * no_cited_excerpts check.
 */
async function expandTopicLessons({topicId, topicData, topicsCol, writer, now}) {
  const subs = Array.isArray(topicData.subtopics) ? topicData.subtopics : [];
  const competencies = Array.isArray(topicData.keyCompetencies) ?
    topicData.keyCompetencies.filter((s) => typeof s === "string" && s.trim()) :
    (Array.isArray(topicData.competencies) ?
      topicData.competencies.filter((s) => typeof s === "string" && s.trim()) : []);

  let written = 0;
  for (const sub of subs) {
    const name = subtopicName(sub);
    if (!name || name === "(unnamed sub-topic)") continue;

    const specificCompetence = typeof sub === "object" && typeof sub.specificCompetence === "string" ?
      sub.specificCompetence.trim() : "";
    const learningActivities = typeof sub === "object" && Array.isArray(sub.learningActivities) ?
      sub.learningActivities.filter((s) => typeof s === "string" && s.trim()) : [];
    const expectedStandard = typeof sub === "object" && typeof sub.expectedStandard === "string" ?
      sub.expectedStandard.trim() : "";

    // Skip subtopics with no usable curriculum content — creating empty
    // lesson docs would cause no_cited_excerpts refusals downstream.
    const hasContent = specificCompetence || learningActivities.length || expectedStandard ||
      competencies.length;
    if (!hasContent) continue;

    const outcomes = specificCompetence ? [specificCompetence] : [];
    const assessmentCriteria = expectedStandard ? [expectedStandard] : [];
    const contentSummary = specificCompetence || expectedStandard ||
      (learningActivities.length ? learningActivities[0] : "");

    const lessonBase = {
      schemaVersion: "1.0",
      grade: topicData.grade || "",
      subject: topicData.subject || "",
      topic: topicData.topic || "",
      subtopic: name,
      suggestedLessons: 2,
      outcomes,
      competencies,
      vocabulary: [],
      contentSummary,
      teacherActivities: [],
      learnerActivities: learningActivities,
      teachingMaterials: [],
      assessmentCriteria,
      exercises: [],
      remedialActivities: [],
      extensionActivities: [],
      sourceDocId: topicData.sourceDocId || "",
      sourceStoragePath: topicData.sourceStoragePath || "",
      verifiedAt: now,
      verifiedBy: "syllabus_activate",
      origin: "syllabus_activate",
      activatedAt: now,
      updatedAt: now,
    };

    // Write for all three term slots so any task term resolves correctly.
    for (const term of [1, 2, 3]) {
      const moduleId = buildModuleId(name, term);
      if (!moduleId) continue;
      const lessonRef = topicsCol.doc(topicId).collection("lessons").doc(moduleId);
      await writer.set(lessonRef, {...lessonBase, term}, {merge: true});
      written++;
    }
  }
  return written;
}

exports.activateSyllabusVersion = onCall(
  {region: "us-central1", timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const role = await getUserRole(uid);
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const version = String(request.data && request.data.version || "").trim();
    if (!VERSION_REGEX.test(version)) {
      throw new HttpsError(
        "invalid-argument",
        "Version must be 3-80 chars, letters/digits/dashes/dots/underscores, " +
        "starting with a letter or digit.",
      );
    }

    const expectedPrevious =
      request.data && typeof request.data.expectedPreviousVersion === "string" ?
        request.data.expectedPreviousVersion : null;

    const db = admin.firestore();
    const draftsCol = db
      .collection("cbcKnowledgeBase")
      .doc(version)
      .collection("draftTopics");
    const topicsCol = db
      .collection("cbcKnowledgeBase")
      .doc(version)
      .collection("topics");
    const metaRef = db.doc("cbcKnowledgeBase/_meta");

    // Concurrency guard: re-read the active pointer here (bypassing the
    // module cache via getActiveKbState's normal 10s TTL is fine — the
    // bigger risk is a stale read, not a missed write). Tighter check
    // uses expectedPreviousVersion when the caller supplied it.
    const activeBefore = await getActiveKbState();
    if (expectedPrevious !== null &&
        activeBefore.version !== expectedPrevious) {
      throw new HttpsError(
        "failed-precondition",
        `Active version is now "${activeBefore.version}", not the ` +
        `"${expectedPrevious}" the activate request was based on. ` +
        "Reload the page and try again.",
      );
    }
    if (activeBefore.version === version) {
      throw new HttpsError(
        "failed-precondition",
        `"${version}" is already the active syllabus.`,
      );
    }

    // Refuse to activate an empty draft set.
    const draftSnap = await draftsCol.limit(1).get();
    if (draftSnap.empty) {
      throw new HttpsError(
        "failed-precondition",
        `No draftTopics under "${version}". Upload + parse first.`,
      );
    }

    // 1+2. Copy drafts → topics AND expand subtopics into lessons/ docs.
    //
    // The parser writes sourceWorkbook/sourceSheet/sourceRow/importedAt/
    // updatedAt on each draft for review traceability; the live topic doc
    // doesn't need them, so scrub on the way through.
    const SCRUB_FIELDS = [
      "sourceWorkbook", "sourceSheet", "sourceRow",
      "importedAt", "updatedAt",
    ];
    const scrubForPromote = (data) => {
      const copy = {...data};
      for (const k of SCRUB_FIELDS) delete copy[k];
      return copy;
    };

    const writer = makeBatchWriter(db);
    const now = admin.firestore.FieldValue.serverTimestamp();
    let promoted = 0;
    let lessonsWritten = 0;

    let pageStart = null;
    let morePages = true;
    const PAGE_SIZE = 200; // smaller page so lesson expansion fits in budget

    /* eslint-disable no-await-in-loop */
    while (morePages) {
      let q = draftsCol.orderBy("__name__").limit(PAGE_SIZE);
      if (pageStart) q = q.startAfter(pageStart);
      const page = await q.get();
      if (page.empty) {
        morePages = false;
        break;
      }

      for (const docSnap of page.docs) {
        const data = docSnap.data() || {};
        const payload = scrubForPromote(data);

        // Promote the topic doc.
        await writer.set(topicsCol.doc(docSnap.id), {
          ...payload,
          origin: payload.origin || "syllabus_activate",
          activatedAt: now,
          updatedAt: now,
        }, {merge: true});
        promoted++;

        // Expand subtopics into individual lesson docs for all term slots.
        lessonsWritten += await expandTopicLessons({
          topicId: docSnap.id,
          topicData: data,
          topicsCol,
          writer,
          now,
        });
      }

      if (page.docs.length < PAGE_SIZE) {
        morePages = false;
      } else {
        pageStart = page.docs[page.docs.length - 1];
      }
    }
    /* eslint-enable no-await-in-loop */

    await writer.finish();

    // 3. Flip the pointer. Single doc write → atomic.
    const previousVersion = activeBefore.version;
    await metaRef.set({
      version,
      usePrivateCurriculum: false,
      cacheBust: admin.firestore.FieldValue.increment(1),
      previousVersion,
      activatedBy: uid,
      activatedAt: now,
      updatedAt: now,
    }, {merge: true});

    // 4. Local invalidate so the response is observably fresh.
    try {
      invalidateKbCache();
    } catch {
      // Best effort.
    }

    // Read back the new cacheBust value for the client UI.
    let cacheBust = null;
    try {
      const snap = await metaRef.get();
      cacheBust = snap.exists ? (Number(snap.data()?.cacheBust) || 0) : 0;
    } catch {
      // Best effort.
    }

    return {
      ok: true,
      version,
      previousVersion,
      promoted,
      lessonsWritten,
      cacheBust,
    };
  },
);
