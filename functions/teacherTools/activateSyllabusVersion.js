/**
 * activateSyllabusVersion — admin-only HTTPS callable.
 *
 * Atomically promotes a parsed-and-reviewed draft syllabus to the active
 * source of truth for every studio. Does three things in one call:
 *
 *   1. Copies every doc in cbcKnowledgeBase/{version}/draftTopics into
 *      cbcKnowledgeBase/{version}/topics with merge:true (idempotent —
 *      re-running an activate doesn't duplicate or corrupt anything).
 *   2. Writes the runtime pointer at cbcKnowledgeBase/_meta to:
 *        {
 *          version,                          // new active version
 *          usePrivateCurriculum: false,      // close the RAG short-circuit
 *          cacheBust: <prev + 1>,            // propagate to warm containers
 *          previousVersion,                  // for one-click rollback
 *          activatedBy, activatedAt, updatedAt
 *        }
 *   3. Locally invalidates the Cloud Function's in-process caches so the
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
 * Returns: { ok, version, previousVersion, promoted, cacheBust }.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {
  invalidateKbCache,
  getActiveKbState,
} = require("./cbcKnowledge");

const VERSION_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/;

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

    // 1. Copy drafts → topics in batches of <=450 ops. The parser
    // writes sourceWorkbook/sourceSheet/sourceRow/importedAt/updatedAt
    // on each draft for review traceability; the live topic doc doesn't
    // need them, so scrub on the way through.
    const SCRUB_FIELDS = [
      "sourceWorkbook", "sourceSheet", "sourceRow",
      "importedAt", "updatedAt",
    ];
    const scrubForPromote = (data) => {
      const copy = {...data};
      for (const k of SCRUB_FIELDS) delete copy[k];
      return copy;
    };

    let promoted = 0;
    let pageStart = null;
    let morePages = true;
    const BATCH_LIMIT = 450;
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Page through drafts using id-ordered scans. snapshot.docs is fine
    // (drafts are at most ~thousands), but page through to keep memory
    // and batch sizing well under quota.
    /* eslint-disable no-await-in-loop */
    while (morePages) {
      let q = draftsCol.orderBy("__name__").limit(BATCH_LIMIT);
      if (pageStart) q = q.startAfter(pageStart);
      const page = await q.get();
      if (page.empty) {
        morePages = false;
        break;
      }

      const batch = db.batch();
      for (const docSnap of page.docs) {
        const data = docSnap.data() || {};
        const payload = scrubForPromote(data);
        batch.set(topicsCol.doc(docSnap.id), {
          ...payload,
          origin: payload.origin || "syllabus_activate",
          activatedAt: now,
          updatedAt: now,
        }, {merge: true});
      }
      await batch.commit();
      promoted += page.docs.length;
      if (page.docs.length < BATCH_LIMIT) {
        morePages = false;
      } else {
        pageStart = page.docs[page.docs.length - 1];
      }
    }
    /* eslint-enable no-await-in-loop */

    // 2. Flip the pointer. Single doc write → atomic.
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

    // 3. Local invalidate so the response is observably fresh.
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
      cacheBust,
    };
  },
);
