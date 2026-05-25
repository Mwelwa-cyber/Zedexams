/**
 * uploadCurriculumModule — admin-only ingest of a curriculum module
 * (DOCX, PDF, or XLSX) straight into the server-side curriculum corpus
 * (`curriculum/{id}` + `rag_chunks/*`) so the teacher-tool generators
 * pick it up immediately. No review queue: the artefact is live the
 * moment the function returns.
 *
 * Why this exists separate from `curriculumWatcher` / `parseSyllabusUpload`:
 *   - The watcher scrapes public CDC pages on a schedule and stages
 *     `reviewStatus: "needs_check"` for human triage.
 *   - `parseSyllabusUpload` parses XLSX workbooks into the curated
 *     `cbcKnowledgeBase` topics — a different surface (admins review
 *     topic structure before promoting).
 *   - This callable lets admins push their own module / textbook /
 *     scheme-of-work / lesson-plan documents into the same RAG corpus
 *     the teacher tools query, marked `importedBy: "admin_upload"` so
 *     scoring + audit can tell them apart from auto-ingested rows.
 *
 * Flow:
 *   1. Admin uploads the file to Storage at
 *      `curriculum-uploads/{uid}/{timestamp}-{filename}.{ext}`.
 *   2. Admin calls this with { storagePath, filename, grade, subject,
 *      term?, topic?, documentType }.
 *   3. We download the bytes, parse with the matching parser
 *      (mammoth for DOCX, pdf-parse for PDF, exceljs for XLSX), chunk
 *      with the same sliding-window helper the watcher uses, embed via
 *      OpenAI text-embedding-3-small, and write everything in a batched
 *      Firestore commit.
 *   4. A summary doc is mirrored to `curriculumUploads/{id}` so the
 *      admin UI can list / delete recent uploads — the `curriculum/`
 *      and `rag_chunks/` collections are server-only via Firestore
 *      rules, so they aren't queryable from the browser.
 *
 * Cost: parsing + chunking is server CPU. Embeddings use OpenAI
 * text-embedding-3-small (~$0.02 / 1M tokens — negligible). Anthropic
 * is not in this path at all.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const {
  chunkText,
  embedChunks,
  parseDocument,
} = require("../agents/learnerAi/runners/curriculumIngester");

const {
  invalidatePrivateCurriculumCache,
  buildIngestTagsFor,
} = require("./privateCurriculum");

const {getUserRole, assertDailyLimit} = require("../aiService");

// Pure helpers live in a sibling file so the test suite can `require`
// them without pulling firebase-functions/v2 (a functions-only dep that
// CI's repo-root `npm ci` doesn't install). Same split as cors.js +
// cors.test.js, dailyExamGrading.js + .test.js.
const {
  extOf,
  sanitiseStoragePath,
  sanitiseGrade,
  sanitiseSubject,
  sanitiseTerm,
  sanitiseTopic,
  sanitiseDocumentType,
  detectKindFromPath,
  parseXlsx,
  buildAdminCurriculumDoc,
  buildAdminCurriculumDocId,
  buildAdminRagChunkDocs,
  SUPPORTED_DOCUMENT_TYPES,
  EXT_TO_KIND,
  MAX_FILE_BYTES,
  MAX_CHUNKS,
} = require("./uploadCurriculumModuleHelpers");

const APPCHECK_ENFORCE_CALLABLE = process.env.APPCHECK_ENFORCE === "1";

async function parseByKind(buffer, kind) {
  if (kind === "xlsx") return parseXlsx(buffer);
  return parseDocument(buffer, kind);
}

// ── Callable ──────────────────────────────────────────────────────

function createUploadCurriculumModule(openaiApiKeySecret) {
  return onCall({
    secrets: [openaiApiKeySecret],
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  }, async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    const uid = request.auth.uid;
    const role = await getUserRole(uid);
    if (role !== "admin") {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const storagePath = sanitiseStoragePath(request.data?.storagePath);
    const grade = sanitiseGrade(request.data?.grade);
    const subject = sanitiseSubject(request.data?.subject);
    const term = sanitiseTerm(request.data?.term);
    const topic = sanitiseTopic(request.data?.topic);
    const documentType = sanitiseDocumentType(request.data?.documentType);
    const filename = sanitiseTopic(request.data?.filename) ||
      (storagePath ? storagePath.split("/").pop() : null);

    if (!storagePath) {
      throw new HttpsError("invalid-argument",
          "storagePath must be under curriculum-uploads/ and end with " +
          ".pdf, .docx, or .xlsx.");
    }
    if (!grade) {
      throw new HttpsError("invalid-argument",
          "grade is required (e.g. G6, G10, F1, ECE).");
    }
    if (!subject) {
      throw new HttpsError("invalid-argument",
          "subject is required (e.g. mathematics, integrated_science).");
    }
    if (!filename) {
      throw new HttpsError("invalid-argument", "filename is required.");
    }

    // Daily-cap enforcement against the calling admin. Reuses the same
    // budget bucket as other admin tools.
    await assertDailyLimit(uid, role, "uploadCurriculumModule");

    const kind = detectKindFromPath(storagePath);
    if (!kind) {
      throw new HttpsError("invalid-argument",
          "Unsupported file type — only .pdf, .docx, .xlsx are accepted.");
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);

    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (err) {
      throw new HttpsError("not-found",
          `Upload not found at ${storagePath}: ` +
          String(err && err.message || err).slice(0, 200));
    }
    const byteLength = Number(metadata?.size || 0);
    if (byteLength > MAX_FILE_BYTES) {
      throw new HttpsError("failed-precondition",
          `File is ${(byteLength / 1024 / 1024).toFixed(1)} MB — limit is ` +
          `${MAX_FILE_BYTES / 1024 / 1024} MB.`);
    }

    let buffer;
    try {
      [buffer] = await file.download();
    } catch (err) {
      throw new HttpsError("internal",
          `Could not read upload: ${String(err && err.message || err).slice(0, 200)}`);
    }

    const parsed = await parseByKind(buffer, kind);
    if (parsed.unsupported) {
      throw new HttpsError("failed-precondition",
          `Parser unavailable for ${kind}: ${parsed.reason || "unknown"}`);
    }
    if (parsed.error) {
      throw new HttpsError("invalid-argument", parsed.error);
    }
    const text = String(parsed.text || "").trim();
    if (!text || text.length < 80) {
      throw new HttpsError("failed-precondition",
          kind === "pdf" ?
            "PDF contained no extractable text (image-only scan?). " +
            "Re-upload an OCR'd copy." :
            "Document contained no extractable text.");
    }

    const chunks = chunkText(text).slice(0, MAX_CHUNKS);
    if (chunks.length === 0) {
      throw new HttpsError("failed-precondition",
          "Document produced zero chunks after parsing.");
    }

    const openaiApiKey = openaiApiKeySecret.value();
    const embedded = await embedChunks(chunks, openaiApiKey);
    const embeddedCount = embedded.filter((c) => c.embedding).length;

    const tags = buildIngestTagsFor(grade, subject);
    // Always include a documentType tag + admin-upload marker so admin
    // tooling can list every uploaded chunk without needing a composite
    // index on documentType.
    const allTags = tags.slice();
    if (!allTags.includes(documentType)) allTags.push(documentType);
    if (!allTags.includes("admin_upload")) allTags.push("admin_upload");

    const curriculumId = buildAdminCurriculumDocId(uid, storagePath);
    const curriculumDoc = buildAdminCurriculumDoc({
      uid, storagePath, filename, kind, grade, subject, term, topic,
      documentType, byteLength, chunkCount: embedded.length,
    });
    const chunkDocs = buildAdminRagChunkDocs(curriculumId, embedded, {
      filename, grade, subject, term, topic, documentType, tags: allTags,
    });

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Batched commit. Firestore batches max 500 ops; chunkDocs is capped
    // at MAX_CHUNKS (200) plus 2 extra docs (curriculum + uploads
    // summary) so we stay well under the limit.
    const batch = db.batch();
    batch.set(db.collection("curriculum").doc(curriculumId), {
      ...curriculumDoc,
      createdAt: now,
      updatedAt: now,
    }, {merge: true});
    for (const chunk of chunkDocs) {
      batch.set(db.collection("rag_chunks").doc(chunk.id), {
        ...chunk.data,
        createdAt: now,
      });
    }
    batch.set(db.collection("curriculumUploads").doc(curriculumId), {
      curriculumDocId: curriculumId,
      storagePath,
      filename,
      kind,
      grade,
      subject,
      term: term != null ? term : null,
      topic: topic || null,
      documentType,
      byteLength,
      chunkCount: embedded.length,
      embeddedCount,
      tags: allTags,
      uploadedBy: uid,
      uploadedAt: now,
    });
    await batch.commit();

    // Force a fresh retrieval read on the next teacher-tool call so the
    // uploaded module is reflected immediately.
    invalidatePrivateCurriculumCache();

    return {
      ok: true,
      curriculumDocId: curriculumId,
      chunkCount: embedded.length,
      embeddedCount,
      kind,
      grade,
      subject,
      documentType,
      tags: allTags,
    };
  });
}

// ── deleteCurriculumUpload ────────────────────────────────────────

/**
 * Tear down a previous upload: removes the summary doc, the curriculum
 * doc, every rag_chunk row keyed on it, and the original Storage blob.
 * Used by the "Delete" button on the admin page.
 */
function createDeleteCurriculumUpload() {
  return onCall({
    region: "us-central1",
    timeoutSeconds: 120,
    memory: "512MiB",
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  }, async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    const role = await getUserRole(request.auth.uid);
    if (role !== "admin") {
      throw new HttpsError("permission-denied", "Admins only.");
    }
    const idRaw = String(request.data?.id || "").trim();
    if (!/^[a-f0-9]{8,64}$/i.test(idRaw)) {
      throw new HttpsError("invalid-argument", "Bad id.");
    }
    const db = admin.firestore();
    const uploadRef = db.collection("curriculumUploads").doc(idRaw);
    const snap = await uploadRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "Upload not found.");
    }
    const data = snap.data() || {};
    const curriculumDocId_ = String(data.curriculumDocId || idRaw);
    const storagePath = typeof data.storagePath === "string" ?
      data.storagePath : null;

    // Delete all rag_chunks for this curriculum doc. Their ids follow
    // the deterministic pattern `${curriculumDocId}_0000` …, so we can
    // query by document id range.
    const startId = `${curriculumDocId_}_`;
    // ￿ is the last code-point Firestore uses for string ordering.
    const endId = `${curriculumDocId_}_￿`;
    const chunksSnap = await db.collection("rag_chunks")
        .where(admin.firestore.FieldPath.documentId(), ">=", startId)
        .where(admin.firestore.FieldPath.documentId(), "<", endId)
        .limit(500)
        .get();

    const batch = db.batch();
    chunksSnap.forEach((doc) => batch.delete(doc.ref));
    batch.delete(db.collection("curriculum").doc(curriculumDocId_));
    batch.delete(uploadRef);
    await batch.commit();

    if (storagePath) {
      try {
        await admin.storage().bucket().file(storagePath).delete({
          ignoreNotFound: true,
        });
      } catch (err) {
        // Non-fatal — Firestore is the source of truth for retrieval;
        // an orphan blob is just dead storage.
        console.warn("[deleteCurriculumUpload] storage delete failed",
            err && err.message);
      }
    }

    invalidatePrivateCurriculumCache();
    return {ok: true, deletedChunks: chunksSnap.size};
  });
}

module.exports = {
  createUploadCurriculumModule,
  createDeleteCurriculumUpload,
  // Helpers are exported here too so existing call-sites stay stable;
  // the test suite imports them straight from ./uploadCurriculumModuleHelpers
  // to avoid pulling firebase-functions/v2 (CI installs root deps only).
  extOf,
  sanitiseStoragePath,
  sanitiseGrade,
  sanitiseSubject,
  sanitiseTerm,
  sanitiseTopic,
  sanitiseDocumentType,
  detectKindFromPath,
  parseXlsx,
  parseByKind,
  buildAdminCurriculumDoc,
  buildAdminRagChunkDocs,
  buildAdminCurriculumDocId,
  SUPPORTED_DOCUMENT_TYPES,
  EXT_TO_KIND,
  MAX_FILE_BYTES,
  MAX_CHUNKS,
};
