/**
 * Staged curriculum module promotion — three admin-only callables that
 * surface the modules the curriculumWatcher ingester has staged into
 * `curriculum/*` and let an admin move them into the canonical
 * `cbcKnowledgeBase/{version}/topics/{topicId}` collection.
 *
 *   listStagedCurriculumModules()
 *     → { ok, modules: [{ curriculumId, ...curriculumDocFields }] }
 *     Returns up to 100 curriculum docs with importedBy='curriculumWatcher'
 *     and reviewStatus='needs_check', ordered by importedAt desc.
 *     A callable (not a direct Firestore read) because firestore.rules
 *     close `curriculum/*` to all clients including admins.
 *
 *   promoteIngestedCurriculumModule({ curriculumId })
 *     → { ok, topicId, version }
 *     Reads `curriculum/{curriculumId}`, derives a deterministic
 *     topicId via the same buildTopicId() helper the rest of the KB
 *     code uses, and upserts a STUB topic row under
 *     cbcKnowledgeBase/{activeVersion}/topics/{topicId}. The stub
 *     carries only grade/subject/term/topic — admin fills the rich
 *     fields (subtopics, outcomes, competencies) in /admin/cbc-kb.
 *     The agent never writes the canonical KB on its own; this
 *     callable is the only path that ingested modules use to reach
 *     cbcKnowledgeBase.
 *     Idempotent: re-promoting an already-promoted module is a no-op
 *     that returns the previously-recorded topicId/version.
 *
 *   rejectIngestedCurriculumModule({ curriculumId, reason? })
 *     → { ok }
 *     Flips reviewStatus → 'rejected' so the module stops appearing
 *     in the staged queue. Optional admin reason recorded for audit.
 *
 * Hard rules:
 *   - All three require an authenticated admin.
 *   - Promotion always uses merge:true on the topic write so any
 *     hand-edited fields the admin already added in /admin/cbc-kb are
 *     preserved. The agent never clobbers admin work.
 *   - The curriculum/* and rag_chunks/* docs are NOT deleted on
 *     promote/reject — they stay as the searchable RAG layer the
 *     teacher-tool generators read through resolveCbcContext()'s
 *     private-curriculum path.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");

const {getUserRole} = require("../aiService");
const {getActiveKbVersion, invalidateKbCache} = require("./cbcKnowledge");

const LIST_LIMIT = 100;

function slug(s) {
  return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
}

// MUST match buildTopicId() in importCurriculumModules.js and
// adminCbcKbService.js so promoted topics attach to the same KB card
// the admin would have created by hand.
function buildTopicId(grade, subject, topic) {
  const g = slug(grade);
  const s = slug(subject);
  const t = slug(topic);
  if (!g || !s || !t) return null;
  return `${g}-${s}-${t}`;
}

async function requireAdmin(request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Please sign in.");
  const role = await getUserRole(uid);
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  return uid;
}

/**
 * Serialise a Firestore doc snapshot to a plain object the SPA can
 * render. Timestamps become ISO strings so React doesn't have to
 * know about Firestore.Timestamp on the client.
 */
function serialiseModule(snap) {
  const d = snap.data() || {};
  const ts = (v) => (v && typeof v.toDate === "function") ?
    v.toDate().toISOString() : null;
  return {
    curriculumId: snap.id,
    source: d.source || null,
    sourceUrl: d.sourceUrl || null,
    sourceName: d.sourceName || null,
    anchorText: d.anchorText || null,
    parsedFrom: d.parsedFrom || null,
    grade: d.grade != null ? d.grade : null,
    subject: d.subject || null,
    term: d.term != null ? d.term : null,
    topic: d.topic || null,
    confidence: d.confidence || "low",
    chunkCount: typeof d.chunkCount === "number" ? d.chunkCount : 0,
    byteLength: typeof d.byteLength === "number" ? d.byteLength : 0,
    importedAt: ts(d.importedAt),
    reviewStatus: d.reviewStatus || null,
    promotedToTopicId: d.promotedToTopicId || null,
    promotedToVersion: d.promotedToVersion || null,
    promotedAt: ts(d.promotedAt),
    rejectedAt: ts(d.rejectedAt),
    rejectedReason: d.rejectedReason || null,
  };
}

exports.listStagedCurriculumModules = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      await requireAdmin(request);
      const db = admin.firestore();
      // Two single-field equality filters + orderBy on a third field —
      // Firestore needs a composite index. To avoid forcing an index
      // deploy, we filter by the most selective field (reviewStatus)
      // server-side and do the importedBy + order in JS. Result set
      // is capped at LIST_LIMIT so JS-side work stays bounded.
      const snap = await db.collection("curriculum")
          .where("reviewStatus", "==", "needs_check")
          .limit(LIST_LIMIT * 2)
          .get();
      const rows = snap.docs
          .filter((d) => (d.get("importedBy") || "") === "curriculumWatcher")
          .sort((a, b) => {
            const at = a.get("importedAt");
            const bt = b.get("importedAt");
            const am = at && typeof at.toMillis === "function" ? at.toMillis() : 0;
            const bm = bt && typeof bt.toMillis === "function" ? bt.toMillis() : 0;
            return bm - am;
          })
          .slice(0, LIST_LIMIT)
          .map(serialiseModule);
      return {ok: true, modules: rows};
    },
);

exports.promoteIngestedCurriculumModule = onCall(
    {timeoutSeconds: 30, memory: "256MiB"},
    async (request) => {
      const uid = await requireAdmin(request);
      const curriculumId = request.data && request.data.curriculumId;
      if (typeof curriculumId !== "string" || !curriculumId) {
        throw new HttpsError(
            "invalid-argument",
            "Provide a curriculumId.",
        );
      }
      const db = admin.firestore();
      const ref = db.collection("curriculum").doc(curriculumId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", `curriculum/${curriculumId} not found.`);
      }
      const d = snap.data() || {};

      if (d.reviewStatus === "promoted") {
        // Idempotent — return the previously-recorded promotion.
        return {
          ok: true,
          topicId: d.promotedToTopicId || null,
          version: d.promotedToVersion || null,
          alreadyPromoted: true,
        };
      }
      if (d.reviewStatus === "rejected") {
        throw new HttpsError(
            "failed-precondition",
            "This module was rejected and cannot be promoted without first " +
            "resetting its review status.",
        );
      }
      if ((d.importedBy || "") !== "curriculumWatcher") {
        throw new HttpsError(
            "failed-precondition",
            "Only curriculumWatcher-ingested modules can be promoted via this " +
            "endpoint.",
        );
      }

      const grade = d.grade;
      const subject = d.subject;
      const topic = d.topic;
      const topicId = buildTopicId(grade, subject, topic);
      if (!topicId) {
        throw new HttpsError(
            "failed-precondition",
            "Module is missing grade/subject/topic — cannot derive a topic id. " +
            "Edit the staged module first.",
        );
      }

      const kbVersion = await getActiveKbVersion();
      const topicRef = db.collection("cbcKnowledgeBase").doc(kbVersion)
          .collection("topics").doc(topicId);
      const now = admin.firestore.FieldValue.serverTimestamp();

      // Stub-only fields. merge:true means any rich data the admin
      // already entered (subtopics/outcomes/etc.) is preserved.
      const term = Number(d.term);
      const stub = {
        id: topicId,
        grade: typeof grade === "number" ? `G${grade}` :
          String(grade || "").toUpperCase(),
        subject: String(subject || "").toLowerCase(),
        term: Number.isInteger(term) && term >= 1 && term <= 3 ? term : 1,
        topic: String(topic || "").slice(0, 200),
        origin: "ingested_from_curriculum_watcher",
        importedFrom: {
          curriculumId,
          sourceUrl: d.sourceUrl || null,
          sourceName: d.sourceName || null,
          confidence: d.confidence || "low",
        },
        updatedAt: now,
      };
      await topicRef.set(stub, {merge: true});

      // Record the promotion on the staging doc so the queue stops
      // showing it and so we can de-dup on re-runs.
      await ref.set({
        reviewStatus: "promoted",
        promotedAt: now,
        promotedBy: uid,
        promotedToTopicId: topicId,
        promotedToVersion: kbVersion,
      }, {merge: true});

      // Flush the server-side KB cache so the next teacher-tool call
      // sees the new topic stub immediately.
      invalidateKbCache();

      return {ok: true, topicId, version: kbVersion};
    },
);

exports.rejectIngestedCurriculumModule = onCall(
    {timeoutSeconds: 15, memory: "256MiB"},
    async (request) => {
      const uid = await requireAdmin(request);
      const curriculumId = request.data && request.data.curriculumId;
      const reason = request.data && request.data.reason;
      if (typeof curriculumId !== "string" || !curriculumId) {
        throw new HttpsError(
            "invalid-argument",
            "Provide a curriculumId.",
        );
      }
      const db = admin.firestore();
      const ref = db.collection("curriculum").doc(curriculumId);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new HttpsError("not-found", `curriculum/${curriculumId} not found.`);
      }
      await ref.set({
        reviewStatus: "rejected",
        rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
        rejectedBy: uid,
        rejectedReason: typeof reason === "string" ?
          reason.slice(0, 500) : null,
      }, {merge: true});
      return {ok: true};
    },
);

// Pure helpers exported for unit tests.
exports._internals = {slug, buildTopicId, serialiseModule};
