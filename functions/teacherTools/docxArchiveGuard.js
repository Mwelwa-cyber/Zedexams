/**
 * docxArchiveGuard — pure, dependency-free defence against malicious or
 * pathological DOCX/ZIP archives (SEC-007). A DOCX is a ZIP; the audit's
 * reachable path is the embedded-image extraction in extractAssessmentFormat
 * (`stageDocxImages`), which reads `word/media/*` via adm-zip.
 *
 * This module owns the SECURITY DECISION only — it never touches adm-zip,
 * firebase-admin or the network, so it unit-tests under plain `node` with the
 * repo's root-only test install (CI's functions tests are root-install-safe).
 * The caller maps its zip library's entry objects into the normalized
 * `{name, uncompressedSize, compressedSize, isDirectory, isEncrypted}` shape
 * and passes them here BEFORE decompressing anything (adm-zip's getEntries()
 * exposes central-directory headers without decompressing), so a bomb is
 * rejected on metadata, never extracted.
 *
 * Limits are intentionally generous for a real Grade 4-7 assessment DOCX
 * (a few hundred parts, images up to ~10MB) and tight against classic
 * zip-bomb ratios (thousands-to-one).
 */

"use strict";

const LIMITS = Object.freeze({
  // Aligns with functions/teacherTools/pastPaperImport.js MAX_DOCX_BYTES and
  // storage.rules' 25MB sample-upload cap.
  maxUploadBytes: 25 * 1024 * 1024,
  maxEntries: 2048,
  maxEntryUncompressedBytes: 12 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxFilenameLength: 256,
});

// A real DOCX (OOXML) always contains this part at the archive root.
const DOCX_SIGNATURE_ENTRY = "[Content_Types].xml";

// ZIP local-file-header ("PK\x03\x04") and empty-archive EOCD ("PK\x05\x06").
function looksLikeZip(buffer) {
  if (!buffer || typeof buffer.length !== "number" || buffer.length < 4) {
    return false;
  }
  const b0 = buffer[0]; const b1 = buffer[1]; const b2 = buffer[2]; const b3 = buffer[3];
  if (b0 !== 0x50 || b1 !== 0x4b) return false; // "PK"
  return (b2 === 0x03 && b3 === 0x04) || (b2 === 0x05 && b3 === 0x06) ||
    (b2 === 0x07 && b3 === 0x08); // spanned/streamed marker
}

function isUnsafePath(name) {
  const n = String(name || "");
  if (n.length === 0) return "empty_name";
  if (n.length > LIMITS.maxFilenameLength) return "entry_name_too_long";
  // Absolute paths (POSIX or Windows drive) and backslash separators.
  if (n.startsWith("/") || n.startsWith("\\")) return "absolute_path";
  if (/^[a-zA-Z]:[\\/]/.test(n)) return "absolute_path";
  // Directory traversal in any segment.
  const segs = n.split(/[\\/]/);
  if (segs.some((s) => s === "..")) return "path_traversal";
  return null;
}

/**
 * Assess a parsed archive's metadata against the limits. Returns
 * `{ok:true}` when safe, else `{ok:false, code, reason}` — the FIRST
 * violation wins. `code` is a stable machine slug for logging/metrics; it is
 * NEVER surfaced to end users (see safeUserError()).
 *
 * @param {object} p
 * @param {number} p.bufferLength — size of the downloaded archive buffer
 * @param {Array<{name:string, uncompressedSize?:number, compressedSize?:number,
 *   isDirectory?:boolean, isEncrypted?:boolean}>} p.entries
 * @param {object} [p.limits] — override subset for tests
 * @returns {{ok:boolean, code?:string, reason?:string}}
 */
function assessArchive({bufferLength, entries, limits} = {}) {
  const L = {...LIMITS, ...(limits || {})};
  const list = Array.isArray(entries) ? entries : [];

  if (!(Number(bufferLength) >= 0)) {
    return {ok: false, code: "no_buffer", reason: "Missing archive buffer."};
  }
  if (bufferLength > L.maxUploadBytes) {
    return {ok: false, code: "archive_too_large",
      reason: "Archive exceeds the maximum accepted size."};
  }
  if (list.length > L.maxEntries) {
    return {ok: false, code: "too_many_entries",
      reason: "Archive has too many entries."};
  }

  // Must be a real DOCX (defence against a renamed arbitrary ZIP).
  const hasSignature = list.some(
      (e) => String(e && e.name) === DOCX_SIGNATURE_ENTRY);
  if (!hasSignature) {
    return {ok: false, code: "not_a_docx",
      reason: "File is not a valid Word document."};
  }

  const seen = new Set();
  let totalUncompressed = 0;
  for (const e of list) {
    const name = String((e && e.name) || "");
    const pathIssue = isUnsafePath(name);
    if (pathIssue) {
      return {ok: false, code: pathIssue, reason: "Unsafe archive entry path."};
    }
    if (e && e.isEncrypted) {
      return {ok: false, code: "encrypted_entry",
        reason: "Encrypted archives are not supported."};
    }
    if (seen.has(name)) {
      return {ok: false, code: "duplicate_entry",
        reason: "Archive contains duplicate entry names."};
    }
    seen.add(name);

    if (e && e.isDirectory) continue; // directory records carry no payload
    const unc = Number(e && e.uncompressedSize) || 0;
    const comp = Number(e && e.compressedSize) || 0;
    if (unc > L.maxEntryUncompressedBytes) {
      return {ok: false, code: "entry_too_large",
        reason: "An archive entry is too large."};
    }
    // Compression-ratio bomb: a tiny compressed part claiming a huge
    // uncompressed size. Only meaningful when the part is non-trivial.
    if (comp > 0 && unc / comp > L.maxCompressionRatio && unc > 64 * 1024) {
      return {ok: false, code: "compression_bomb",
        reason: "An archive entry has an unsafe compression ratio."};
    }
    totalUncompressed += unc;
    if (totalUncompressed > L.maxTotalUncompressedBytes) {
      return {ok: false, code: "total_too_large",
        reason: "Archive decompresses to an unsafe total size."};
    }
  }
  return {ok: true};
}

// The single safe user-facing message. Never leaks the internal code, the
// threshold, dependency names or stack traces.
function safeUserError() {
  return "This document could not be processed because it is too large, " +
    "damaged, or contains an unsafe archive structure.";
}

module.exports = {
  LIMITS,
  DOCX_SIGNATURE_ENTRY,
  looksLikeZip,
  isUnsafePath,
  assessArchive,
  safeUserError,
};
