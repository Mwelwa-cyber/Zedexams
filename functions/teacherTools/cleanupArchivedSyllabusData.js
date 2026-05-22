/**
 * cleanupArchivedSyllabusData — admin-only HTTPS callable.
 *
 * Phase E. After the new syllabus has been live and trusted for a
 * verification window (recommend ≥ 2 weeks), this callable lets an
 * admin delete the leftover data the migration left behind:
 *
 *  - curriculum/* — the pre-Phase-A CDC "module" docs. The Phase B RAG
 *    gate (active.usePrivateCurriculum) routes generators around these,
 *    but they still occupy storage.
 *  - rag_chunks/* — same, the retrieval chunks tagged by old-syllabus.
 *  - cbcKnowledgeBase/{oldVersion}/topics/* (and lessons/* underneath)
 *    — old syllabus version archived by activate. Admin opts in per
 *    version; default is to keep them for ping-pong rollback.
 *
 * Modes (request.data.mode):
 *  - "audit"          — read-only. Returns doc counts for the three
 *                       deletable targets. Use this to sanity-check
 *                       before pulling the trigger.
 *  - "delete-rag"     — delete curriculum/* and rag_chunks/*.
 *                       REFUSES if active.usePrivateCurriculum is true
 *                       (the RAG path is still live; deletion would
 *                       break running generations).
 *  - "delete-version" — delete cbcKnowledgeBase/{version}/topics/*
 *                       recursively (subcollections included). Targets
 *                       request.data.version. REFUSES if version equals
 *                       active.version (current syllabus) or
 *                       active.previousVersion (rollback target).
 *                       Caller must echo request.data.confirmVersion
 *                       === version — a deliberate-typo guard against
 *                       deleting the wrong KB.
 *
 * Returns { ok, mode, deleted: { curriculum, rag_chunks, topics } }.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  invalidateKbCache,
  getActiveKbState,
} = require("./cbcKnowledge");

// Same regex the activate callable uses — keep version inputs
// consistent across the pipeline.
const VERSION_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/;

exports.cleanupArchivedSyllabusData = onCall(
  {region: "us-central1", timeoutSeconds: 540, memory: "512MiB"},
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const role = await getUserRole(uid);
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const mode = String(request.data && request.data.mode || "").trim();
    const active = await getActiveKbState();

    if (mode === "audit") {
      return runAudit();
    }
    if (mode === "delete-rag") {
      if (active.usePrivateCurriculum) {
        throw new HttpsError(
          "failed-precondition",
          "Refusing to delete curriculum/* and rag_chunks/* while " +
          "active.usePrivateCurriculum is true. Activate a new syllabus " +
          "(or set the flag to false in _meta) first.",
        );
      }
      const out = await deleteRagPath();
      try {
        invalidateKbCache();
      } catch {
        // Best effort.
      }
      return {ok: true, mode, deleted: out};
    }
    if (mode === "delete-version") {
      const version = String(request.data && request.data.version || "").trim();
      const confirm = String(
        request.data && request.data.confirmVersion || "",
      ).trim();
      if (!VERSION_REGEX.test(version)) {
        throw new HttpsError(
          "invalid-argument",
          "version must match the standard KB version regex.",
        );
      }
      if (version !== confirm) {
        throw new HttpsError(
          "invalid-argument",
          "confirmVersion must exactly equal version. Typing it twice " +
          "is the deliberate-deletion guard.",
        );
      }
      if (version === active.version) {
        throw new HttpsError(
          "failed-precondition",
          `Refusing to delete the active version (${version}). Activate ` +
          "or roll back first.",
        );
      }
      // Note: previousVersion may not exist on _meta if the system is
      // still on the seed; only block when it's actually set.
      const previousVersion = active.previousVersion || null;
      if (previousVersion && version === previousVersion) {
        throw new HttpsError(
          "failed-precondition",
          `Refusing to delete the rollback target (${version} is ` +
          "_meta.previousVersion). Activate something else first so " +
          "this version is no longer the rollback target.",
        );
      }
      const deletedTopics = await deleteVersionTopics(version);
      try {
        invalidateKbCache();
      } catch {
        // Best effort.
      }
      return {ok: true, mode, deleted: {topics: deletedTopics}, version};
    }

    throw new HttpsError(
      "invalid-argument",
      `mode must be "audit", "delete-rag", or "delete-version" ` +
      `(got "${mode}").`,
    );
  },
);

// --- Audit -------------------------------------------------------------

async function runAudit() {
  const db = admin.firestore();
  const [curriculumCount, ragCount] = await Promise.all([
    countCollection(db.collection("curriculum")),
    countCollection(db.collection("rag_chunks")),
  ]);

  // List every KB version that has topics under it. The list is
  // bounded (versions are admin-created), so a plain getDocs is fine.
  const versionsSnap = await db.collection("cbcKnowledgeBase").listDocuments();
  const versions = [];
  for (const ref of versionsSnap) {
    // Skip the _meta pointer doc — it's not a version-doc.
    if (ref.id === "_meta") continue;
    /* eslint-disable no-await-in-loop */
    const topicCount = await countCollection(ref.collection("topics"));
    /* eslint-enable no-await-in-loop */
    versions.push({version: ref.id, topicCount});
  }

  return {
    ok: true,
    mode: "audit",
    counts: {
      curriculum: curriculumCount,
      rag_chunks: ragCount,
    },
    versions,
  };
}

async function countCollection(col) {
  try {
    const snap = await col.count().get();
    return Number(snap.data().count || 0);
  } catch {
    // Fallback to a getDocs scan if count() isn't supported (some
    // emulator versions). Capped so a misconfigured collection can't
    // hang the audit.
    try {
      const docs = await col.limit(2000).get();
      return docs.size;
    } catch {
      return 0;
    }
  }
}

// --- Delete RAG --------------------------------------------------------

async function deleteRagPath() {
  const db = admin.firestore();
  // recursiveDelete handles paging + subcollections + 500-op batching
  // internally. firebase-admin v11+ ships it; we're on v13.
  const curriculum = await recursiveDeleteCollection(db, "curriculum");
  const rag = await recursiveDeleteCollection(db, "rag_chunks");
  return {curriculum, rag_chunks: rag};
}

async function recursiveDeleteCollection(db, collectionPath) {
  // Manual page-and-delete: admin.firestore.recursiveDelete on a CollectionReference
  // also works, but doing it explicitly lets us return an accurate
  // deleted-doc count. 400 leaves headroom under the 500-op batch cap.
  const BATCH_SIZE = 400;
  const col = db.collection(collectionPath);
  let deleted = 0;
  let morePages = true;
  /* eslint-disable no-await-in-loop */
  while (morePages) {
    const page = await col.limit(BATCH_SIZE).get();
    if (page.empty) {
      morePages = false;
      break;
    }
    const batch = db.batch();
    page.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += page.size;
    if (page.size < BATCH_SIZE) morePages = false;
  }
  /* eslint-enable no-await-in-loop */
  return deleted;
}

// --- Delete version ----------------------------------------------------

async function deleteVersionTopics(version) {
  const db = admin.firestore();
  const topicsCol = db
    .collection("cbcKnowledgeBase")
    .doc(version)
    .collection("topics");

  let deleted = 0;
  const BATCH_SIZE = 400;
  /* eslint-disable no-await-in-loop */
  let pageStart = null;
  let morePages = true;
  while (morePages) {
    let q = topicsCol.orderBy("__name__").limit(BATCH_SIZE);
    if (pageStart) q = q.startAfter(pageStart);
    const page = await q.get();
    if (page.empty) {
      morePages = false;
      break;
    }
    // Each topic can have a `lessons` subcollection. Delete those first
    // so we don't orphan them, then delete the topic doc itself.
    for (const docSnap of page.docs) {
      const lessonsDeleted = await recursiveDeleteCollection(
        db,
        `cbcKnowledgeBase/${version}/topics/${docSnap.id}/lessons`,
      );
      deleted += lessonsDeleted;
    }
    const batch = db.batch();
    page.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += page.size;
    if (page.size < BATCH_SIZE) {
      morePages = false;
    } else {
      pageStart = page.docs[page.docs.length - 1];
    }
  }
  /* eslint-enable no-await-in-loop */

  // Drop the parent-version doc too if it ended up created (idempotent;
  // the doc may not exist if topics were never written here).
  try {
    await db.collection("cbcKnowledgeBase").doc(version).delete();
  } catch {
    // Best effort.
  }
  return deleted;
}
