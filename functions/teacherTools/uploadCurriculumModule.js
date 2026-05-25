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
  parseDocument,
  chunkText,
  embedChunks,
  curriculumDocId,
  ragChunkDocId,
  EMBED_MODEL,
} = require("../agents/learnerAi/runners/curriculumIngester");

const {
  invalidatePrivateCurriculumCache,
  buildIngestTagsFor,
} = require("./privateCurriculum");

const {getUserRole, assertDailyLimit} = require("../aiService");

const APPCHECK_ENFORCE_CALLABLE = process.env.APPCHECK_ENFORCE === "1";

// 25 MB matches the existing syllabus uploads — large enough for a
// full textbook chapter, small enough to keep Storage costs sane.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const SUPPORTED_DOCUMENT_TYPES = Object.freeze([
  "module",
  "syllabus",
  "scheme_of_work",
  "lesson_plan",
  "assessment",
  "teachers_guide",
  "learners_book",
]);

const EXT_TO_KIND = Object.freeze({
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
});

// Bound the result size so a fat workbook can't produce a 50MB Firestore
// write. Same cap as the watcher (MAX_CHUNKS_PER_MODULE) for consistency.
const MAX_CHUNKS = 200;

// ── Pure helpers (exported for tests) ────────────────────────────

function extOf(value) {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(String(value || ""));
  return m ? m[1].toLowerCase() : "";
}

function sanitiseStoragePath(value) {
  const v = String(value || "").trim();
  if (!v || v.length > 500) return null;
  if (!v.startsWith("curriculum-uploads/")) return null;
  if (v.includes("..")) return null;
  const ext = extOf(v);
  if (!Object.prototype.hasOwnProperty.call(EXT_TO_KIND, ext)) return null;
  return v;
}

function sanitiseGrade(value) {
  const v = String(value || "").trim().toUpperCase();
  if (/^G\d{1,2}$/.test(v) || v === "ECE" || /^F\d{1,2}$/.test(v)) return v;
  return null;
}

function sanitiseSubject(value) {
  const v = String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_\s]/g, "")
      .replace(/\s+/g, "_");
  return v && v.length <= 64 ? v : null;
}

function sanitiseTerm(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3) return null;
  return n;
}

function sanitiseTopic(value) {
  if (value == null) return null;
  const v = String(value).replace(/\s+/g, " ").trim().slice(0, 200);
  return v || null;
}

function sanitiseDocumentType(value) {
  const v = String(value || "module").toLowerCase().trim();
  return SUPPORTED_DOCUMENT_TYPES.includes(v) ? v : "module";
}

function detectKindFromPath(storagePath) {
  return EXT_TO_KIND[extOf(storagePath)] || null;
}

// ── XLSX parser (exceljs is already in functions/package.json) ────

/**
 * Flatten an Excel workbook into a single text blob + per-sheet headings.
 *
 * Each row is joined with " | " between cells and each sheet is prefixed
 * by its name (so chunking + retrieval still know which sheet a row came
 * from). Empty rows are skipped. Returns the same shape as parseDocument
 * for the other formats: { text, headings, error? }.
 */
async function parseXlsx(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return {text: "", headings: []};
  }
  let ExcelJS;
  try {
    ExcelJS = require("exceljs");
  } catch (err) {
    return {
      text: "", headings: [], unsupported: true,
      reason: `exceljs_missing:${String(err && err.message || "").slice(0, 80)}`,
    };
  }
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const lines = [];
    const headings = [];
    wb.eachSheet((sheet) => {
      const sheetName = String(sheet.name || "").trim();
      if (sheetName) {
        headings.push(sheetName);
        lines.push(`\n## ${sheetName}\n`);
      }
      sheet.eachRow({includeEmpty: false}, (row) => {
        // ExcelJS hands cells as a sparse array indexed from 1.
        const values = [];
        row.eachCell({includeEmpty: false}, (cell) => {
          const v = cell.value;
          let cellText = "";
          if (v == null) cellText = "";
          else if (typeof v === "string") cellText = v;
          else if (typeof v === "number" || typeof v === "boolean") cellText = String(v);
          else if (v instanceof Date) cellText = v.toISOString().slice(0, 10);
          else if (typeof v === "object") {
            // Rich text, hyperlink, formula, etc.
            if (Array.isArray(v.richText)) cellText = v.richText.map((r) => r.text || "").join("");
            else if (typeof v.text === "string") cellText = v.text;
            else if (typeof v.result !== "undefined") cellText = String(v.result);
            else if (typeof v.hyperlink === "string") cellText = v.hyperlink;
          }
          cellText = String(cellText).replace(/\s+/g, " ").trim();
          if (cellText) values.push(cellText);
        });
        if (values.length) lines.push(values.join(" | "));
      });
    });
    const text = lines.join("\n").trim();
    return {text, headings};
  } catch (err) {
    return {
      text: "", headings: [],
      error: `xlsx_parse_failed:${String(err && err.message || "").slice(0, 120)}`,
    };
  }
}

async function parseByKind(buffer, kind) {
  if (kind === "xlsx") return parseXlsx(buffer);
  return parseDocument(buffer, kind);
}

// ── Firestore doc builders ────────────────────────────────────────

/**
 * Build the curriculum doc id. Differs from the watcher's hash of
 * sourceUrl because admin uploads have no canonical URL — we key on
 * uploader uid + storage path + upload-time stamp so re-uploads of the
 * same file land in distinct rows (admin probably wants a separate
 * revision rather than an in-place overwrite).
 */
function buildAdminCurriculumDocId(uid, storagePath) {
  // Re-use the watcher's sha256 via curriculumDocId by passing a
  // synthetic "url" that includes the uid so it's deterministic per
  // upload.
  return curriculumDocId({sourceUrl: `admin:${uid}:${storagePath}`});
}

function buildAdminCurriculumDoc({
  uid, storagePath, filename, kind, grade, subject, term, topic,
  documentType, byteLength, chunkCount,
}) {
  return {
    source: "admin_upload",
    sourceUrl: null,
    sourceName: filename,
    parsedFrom: kind,
    storagePath,
    anchorText: topic || filename,
    grade,
    subject,
    term: term != null ? term : null,
    topic: topic || null,
    documentType,
    confidence: "high",
    byteLength: byteLength || 0,
    chunkCount: chunkCount || 0,
    importedBy: "admin_upload",
    uploadedBy: uid,
    reviewStatus: "approved",
  };
}

function buildAdminRagChunkDocs(curriculumId, embedded, meta) {
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  return embedded.map((c, index) => ({
    id: ragChunkDocId(curriculumId, index),
    data: {
      syllabus_id: curriculumId,
      source_group: "admin_upload",
      curriculum_doc_id: curriculumId,
      source_url: null,
      title: meta.topic || meta.filename || null,
      grade: meta.grade != null ? meta.grade : null,
      subject: meta.subject || null,
      term: meta.term != null ? meta.term : null,
      topic_title: meta.topic || null,
      documentType: meta.documentType || "module",
      tags,
      chunk_index: index,
      text: c.text,
      embedding: c.embedding || null,
      embedding_model: c.embedding ? EMBED_MODEL : null,
    },
  }));
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
  // Exposed for tests
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
