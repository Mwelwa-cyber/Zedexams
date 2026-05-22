/**
 * invalidateKbCacheCallable — admin-only HTTPS callable.
 *
 * Forces every warm Cloud Function container to refresh its in-process CBC
 * caches on the next request, AND propagates the bust to all other regions
 * by bumping a Firestore counter that the helpers compare against on every
 * active-state read.
 *
 * When to call:
 *  - After a Phase C "approve and activate new syllabus" run
 *  - After a Phase D rollback
 *  - From the admin UI's "Refresh now" button if a generation is still
 *    using stale topic data after an edit
 *
 * The new cacheBust value is written to cbcKnowledgeBase/_meta.cacheBust;
 * the active-state cache in cbcKnowledge.js notices the change on its next
 * 10-second poll and resets the topic + RAG caches. The container handling
 * this exact request is invalidated synchronously.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {invalidateKbCache} = require("./cbcKnowledge");

exports.invalidateKbCacheCallable = onCall(
  {region: "us-central1", timeoutSeconds: 30, memory: "256MiB"},
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
    const role = await getUserRole(uid);
    if (role !== "admin" && role !== "superAdmin") {
      throw new HttpsError("permission-denied", "Admin only.");
    }

    const db = admin.firestore();
    const ref = db.doc("cbcKnowledgeBase/_meta");
    // Increment the counter so OTHER warm containers see the change on
    // their next getActiveKbState() refresh (within ~10s).
    await ref.set({
      cacheBust: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});

    // Locally invalidate this container immediately so the response is
    // observably fresh from the caller's perspective.
    try {
      invalidateKbCache();
    } catch {
      // Best effort.
    }

    // Read back the new counter for return + observability.
    let cacheBust = null;
    try {
      const snap = await ref.get();
      cacheBust = snap.exists ? (Number(snap.data()?.cacheBust) || 0) : 0;
    } catch {
      // Best effort — the bump already happened.
    }

    return {ok: true, cacheBust};
  },
);
