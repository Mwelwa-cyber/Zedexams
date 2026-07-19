/**
 * Pure helpers for extractAssessmentFormat. Split out from the callable
 * (same pattern as uploadCurriculumModuleHelpers.js) so the unit test can
 * load them without pulling firebase-functions/firebase-admin, which live
 * in functions/package.json — CI's test job installs root deps only.
 *
 * COPYRIGHT RULE: the extraction prompt below instructs the model to
 * distil CONVENTIONS (structure, wording patterns, numbering, marks
 * habits, register) and to write exemplar questions as FRESH PARAPHRASES
 * in the same style — never to transcribe the source paper beyond short
 * conventional phrases ("Answer ALL questions"). The admin review step in
 * /admin (CBC KB page) is the human backstop before a draft goes live.
 */

const {
  ASSESSMENT_TYPES,
  GRADE_BANDS,
  validateFormatProfile,
  buildFormatId,
} = require("./assessmentFormats");

const SAMPLE_PATH_PREFIX = "assessment-format-samples/";

// Photos of papers (jpg/png/webp) resolve to the "images" source kind so
// buildMessageBlocks sends them to Claude's vision as page images — same
// path scanned past papers take.
const EXT_TO_KIND = Object.freeze({
  pdf: "pdf", docx: "docx",
  jpg: "images", jpeg: "images", png: "images", webp: "images",
});
const SAMPLE_IMAGE_MIME = Object.freeze({
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
});

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function extOf(value) {
  const m = /\.([a-z0-9]+)(?:\?|#|$)/i.exec(String(value || ""));
  return m ? m[1].toLowerCase() : "";
}

/**
 * Validate a direct-upload storage path. Must live under the
 * assessment-format-samples/ prefix (admin-write in storage.rules) and be
 * a .pdf or .docx. Returns the path or null.
 */
function sanitiseSamplePath(value) {
  const v = String(value || "").trim();
  if (!v || v.length > 500) return null;
  if (!v.startsWith(SAMPLE_PATH_PREFIX)) return null;
  if (v.includes("..")) return null;
  if (!Object.prototype.hasOwnProperty.call(EXT_TO_KIND, extOf(v))) return null;
  return v;
}

/** 'pdf' | 'docx' | null for a sanitised sample path. */
function kindFromPath(storagePath) {
  return EXT_TO_KIND[extOf(storagePath)] || null;
}

/**
 * Build the pastPaperImport-compatible source descriptor for a directly
 * uploaded sample file, so buildMessageBlocks() handles the download,
 * size caps and DOCX→text extraction identically to past papers.
 */
function sourceForSamplePath(storagePath) {
  const ext = extOf(storagePath);
  const kind = EXT_TO_KIND[ext] || null;
  if (kind === "pdf") return {kind: "pdf", path: storagePath, size: null};
  if (kind === "docx") {
    return {kind: "docx", path: storagePath, size: null, mime: DOCX_MIME};
  }
  if (kind === "images") {
    return {
      kind: "images",
      items: [{
        path: storagePath,
        contentType: SAMPLE_IMAGE_MIME[ext] || "image/jpeg",
      }],
    };
  }
  return null;
}

// Mirrors the format-profile shape in assessmentFormats.js. Kept
// intentionally permissive (like the other generator tool schemas) —
// validateFormatProfile does the strict checks afterwards.
const FORMAT_PROFILE_TOOL_SCHEMA = {
  type: "object",
  description: "A Zambian assessment format profile distilled from a sample paper.",
  additionalProperties: true,
  properties: {
    label: {type: "string"},
    paperStructure: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: {type: "string"},
          heading: {type: "string"},
          instructions: {type: "string"},
          questionTypes: {type: "array", items: {type: "string"}},
          questionCountHint: {type: "string"},
          marksShare: {type: "number"},
          marksPerQuestionHint: {type: "string"},
        },
      },
    },
    coverInstructions: {type: "array", items: {type: "string"}},
    numberingStyle: {type: "string"},
    phrasingNotes: {type: "array", items: {type: "string"}},
    marksConventions: {type: "array", items: {type: "string"}},
    diagramConventions: {type: "array", items: {type: "string"}},
    exemplarQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          type: {type: "string"},
          marks: {type: "number"},
          prompt: {type: "string"},
          note: {type: "string"},
        },
      },
    },
  },
  required: ["label", "paperStructure", "coverInstructions", "numberingStyle"],
};

const EXTRACT_SYSTEM_PROMPT = `You are a senior Zambian examiner analysing a sample school assessment paper. Your job is to distil the paper's FORMAT into a reusable profile — how papers of this kind are laid out — NOT to copy its content.

Extract:
- Paper structure: each section in order, with its printed heading style, its section instruction wording, the question types it uses, roughly how many questions it has, and what share of the total marks it carries (marksShare values must sum to 100).
- Front-page instructions: the instruction lines as worded on the cover/header.
- Numbering style: how sections are lettered, how questions are numbered (continuous or per-section), how multi-part questions are labelled, and how marks are shown.
- Phrasing and register: the command words used (State, Calculate, Explain…), sentence length, and the kinds of Zambian contexts and names that appear.
- Marks conventions: how marks are allocated (per point, method + answer, part splits).
- Diagram conventions: when and how the paper uses figures, tables, maps or graphs.
- 2-4 exemplar questions.

COPYRIGHT — HARD RULES:
- Exemplar questions must be FRESH PARAPHRASES you write yourself in the same style, difficulty and register as the paper's questions. NEVER transcribe a question, passage or answer from the paper.
- Do not reproduce any passage, data table or diagram content from the paper.
- Short conventional instruction phrases ("Answer ALL questions.", "Show ALL your working.") may be kept verbatim — they are standard wording, not creative content.

Output a single structured object via the tool. No prose outside the tool call.`;

function describeMeta({assessmentType, gradeBand, subject}) {
  return [
    `- Assessment type: ${assessmentType}`,
    `- Grade band: ${gradeBand}`,
    `- Subject: ${subject === "_generic" ? "(generic — any subject)" : subject}`,
  ].join("\n");
}

function buildExtractUserPrompt(meta) {
  return [
    "Distil the format profile from the attached sample paper.",
    "",
    "The admin has classified this paper as:",
    describeMeta(meta),
    "",
    "Describe the format so a different paper of the same kind could be " +
      "written from your profile alone. Remember: exemplars are fresh " +
      "paraphrases, never copies.",
  ].join("\n");
}

/**
 * Turn the model's tool output into a draft profile doc. The admin's
 * classification (type/band/subject) always wins over anything the model
 * inferred, and the doc id the profile would publish under is derived
 * from it. Validation errors don't block the draft — the admin fixes
 * them in the review modal — but they're surfaced on the doc.
 */
function buildDraftFromExtraction({
  extracted, assessmentType, gradeBand, subject, sourceKind, sourceNote,
}) {
  if (!ASSESSMENT_TYPES.includes(assessmentType)) {
    return {error: "Pick a valid assessment type."};
  }
  if (!GRADE_BANDS.includes(gradeBand)) {
    return {error: "Pick a valid grade band."};
  }
  const subjectKey = String(subject || "_generic")
    .toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 60) || "_generic";

  const candidate = {
    ...(extracted && typeof extracted === "object" ? extracted : {}),
    assessmentType,
    gradeBand,
    subject: subjectKey,
    id: buildFormatId({assessmentType, gradeBand, subject: subjectKey}),
    status: "draft",
    origin: sourceKind === "docx" ? "docx_extract" : "pdf_extract",
    sourceNote: String(sourceNote || "").slice(0, 300),
  };
  const check = validateFormatProfile(candidate);
  return {
    draft: {
      ...check.value,
      status: "draft",
      validationErrors: check.errors,
    },
    validationErrors: check.errors,
  };
}

// ── Embedded-image extraction (picture bank staging) ─────────────────────
// DOCX media entries are a mix of real teaching figures (anatomy diagrams,
// the Coat of Arms, Venn diagrams) and noise (school logos, decorative
// clipart, drawing-canvas fragments). We can't tell them apart reliably
// server-side, so we stage everything that *could* be content and let the
// admin tag or discard each one in the picture-bank review UI.

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
// Below this, an image is almost always a logo fragment, bullet art or a
// drawing-canvas sliver rather than a printable teaching figure.
const MIN_CONTENT_IMAGE_BYTES = 4 * 1024;
const MAX_CONTENT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES_PER_PAPER = 20;

const EXT_TO_CONTENT_TYPE = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
});

// Defence-in-depth against a maliciously crafted DOCX/ZIP (a "zip bomb":
// GHSA-xcpc-8h2w-3j85). The adm-zip@^0.6.0 bump fixes the parse-time 4GB
// allocation itself; these caps bound what we then read into memory on the
// 1GiB function. MAX_DOCX_BUFFER_BYTES caps the downloaded container we hand
// to the parser (storage.rules already caps direct sample uploads at 25MB;
// this also covers past-paper-sourced DOCX). MAX_TOTAL_MEDIA_BYTES caps the
// sum of media we actually extract via getData(), on top of the per-entry
// 10MB cap in isLikelyContentImage and the MAX_IMAGES_PER_PAPER slice.
const MAX_DOCX_BUFFER_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 64 * 1024 * 1024;

/**
 * Return the leading run of media entries whose cumulative declared size
 * (byteLength) stays within maxTotalBytes. Entries are {name, byteLength,…};
 * a single entry already over the cap yields an empty list. Pure, so the
 * bound is unit-testable without adm-zip or a real DOCX.
 *
 * @param {Array<{byteLength?: number}>} entries
 * @param {number} [maxTotalBytes]
 * @returns {Array<object>}
 */
function capMediaByTotalBytes(entries, maxTotalBytes = MAX_TOTAL_MEDIA_BYTES) {
  const out = [];
  let total = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const size = Number(e && e.byteLength) || 0;
    if (total + size > maxTotalBytes) break;
    total += size;
    out.push(e);
  }
  return out;
}

/**
 * Decide whether a DOCX media entry looks like a teaching figure worth
 * staging. `entry` is {name, byteLength}. Pure, so the filter rules are
 * unit-testable.
 */
function isLikelyContentImage(entry) {
  const ext = extOf(entry && entry.name);
  if (!IMAGE_EXTS.has(ext)) return false;
  const size = Number(entry && entry.byteLength) || 0;
  return size >= MIN_CONTENT_IMAGE_BYTES && size <= MAX_CONTENT_IMAGE_BYTES;
}

/**
 * Build the pictureBank doc for one staged image. The admin supplies the
 * real name + keywords during review; until then the doc carries enough
 * provenance to render and triage it.
 */
function buildStagedPictureDoc({
  index, ext, storagePath, subject, gradeBand, draftId, sourceNote, uid,
}) {
  return {
    name: `Extracted image ${index + 1}`,
    nameLower: `extracted image ${index + 1}`,
    subject: String(subject || "_generic"),
    gradeBand: String(gradeBand || ""),
    keywords: [],
    storagePath,
    url: null,
    contentType: EXT_TO_CONTENT_TYPE[ext] || "application/octet-stream",
    source: "extracted",
    status: "staged",
    sourceDraftId: draftId || null,
    sourceNote: String(sourceNote || "").slice(0, 300),
    createdBy: uid || null,
  };
}

module.exports = {
  SAMPLE_PATH_PREFIX,
  EXT_TO_KIND,
  EXT_TO_CONTENT_TYPE,
  MAX_IMAGES_PER_PAPER,
  MAX_DOCX_BUFFER_BYTES,
  MAX_TOTAL_MEDIA_BYTES,
  capMediaByTotalBytes,
  extOf,
  sanitiseSamplePath,
  kindFromPath,
  sourceForSamplePath,
  FORMAT_PROFILE_TOOL_SCHEMA,
  EXTRACT_SYSTEM_PROMPT,
  buildExtractUserPrompt,
  buildDraftFromExtraction,
  isLikelyContentImage,
  buildStagedPictureDoc,
};
