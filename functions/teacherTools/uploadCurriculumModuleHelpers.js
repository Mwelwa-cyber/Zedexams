/**
 * Pure helpers for uploadCurriculumModule. Split out from
 * uploadCurriculumModule.js so unit tests can load them without
 * pulling firebase-functions/v2 (which is in functions/package.json,
 * not the repo root, so `npm ci && npm run test:all` would otherwise
 * fail in CI).
 *
 * Same split pattern as functions/cors.js + cors.test.js and
 * functions/grading/dailyExamGrading.js + .test.js — the callable file
 * imports from here, tests import only this file.
 */

const crypto = require("crypto");

const EMBED_MODEL = "text-embedding-3-small";

function curriculumDocId(meta) {
  const hash = crypto.createHash("sha256")
      .update(String(meta.sourceUrl || meta.url || ""))
      .digest("hex");
  return hash.slice(0, 32);
}

function ragChunkDocId(curriculumId, index) {
  return `${curriculumId}_${String(index).padStart(4, "0")}`;
}

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

/**
 * Flatten an Excel workbook into a single text blob + per-sheet headings.
 * Each row is joined with " | " between cells and each sheet is prefixed
 * by its name. Returns the same shape as parseDocument: { text, headings,
 * unsupported?, error? }. Lazy-requires exceljs so tests that don't
 * exercise this path don't need it installed.
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
        const values = [];
        row.eachCell({includeEmpty: false}, (cell) => {
          const v = cell.value;
          let cellText = "";
          if (v == null) cellText = "";
          else if (typeof v === "string") cellText = v;
          else if (typeof v === "number" || typeof v === "boolean") cellText = String(v);
          else if (v instanceof Date) cellText = v.toISOString().slice(0, 10);
          else if (typeof v === "object") {
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

/**
 * Build the curriculum doc id. Differs from the watcher's hash of
 * sourceUrl because admin uploads have no canonical URL — we key on
 * uploader uid + storage path so re-uploads of the same file land on a
 * deterministic id (re-uploads with a fresh timestamp filename produce
 * a new row, which is what we want for revision history).
 */
function buildAdminCurriculumDocId(uid, storagePath) {
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

module.exports = {
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
};
