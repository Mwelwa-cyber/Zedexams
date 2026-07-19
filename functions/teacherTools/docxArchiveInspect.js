/**
 * docxArchiveInspect — the SHARED "guard before decompression" step for every
 * DOCX path (SEC-007). It parses only the ZIP central directory (entry headers,
 * no payload decompression), runs the pure docxArchiveGuard decision on that
 * metadata, and returns a verdict + the raw entries for the caller to use.
 *
 * Both DOCX consumers go through this before handing the buffer to a
 * decompressing library:
 *   • functions/teacherTools/pastPaperImport.js  → mammoth (text)
 *   • functions/teacherTools/extractAssessmentFormat.js → adm-zip getData (images)
 * so a bomb / traversal / malformed / fake-.docx archive is rejected BEFORE
 * mammoth or adm-zip ever decompresses a byte.
 *
 * The zip parser is injectable (`parseEntries`) so this module unit-tests under
 * the repo's root-only install with NO adm-zip: the default parser lazily
 * `require('adm-zip')` only when actually called in production. The magic-byte
 * + size gates run BEFORE the parser, so a non-zip / oversized buffer never
 * reaches it (the test asserts the parser spy is not called in that case).
 */

"use strict";

const {looksLikeZip, assessArchive, LIMITS, safeUserError} =
  require("./docxArchiveGuard");

// Default entry parser: central-directory headers only (no getData()).
function defaultParseEntries(buffer) {
  const AdmZip = require("adm-zip"); // lazy — never loaded by the injected test
  return new AdmZip(buffer).getEntries();
}

// Map an adm-zip Entry to the pure guard's normalized metadata shape.
function toMeta(e) {
  return {
    name: e && e.entryName,
    isDirectory: Boolean(e && e.isDirectory),
    uncompressedSize: Number(e && e.header && e.header.size) || 0,
    compressedSize: Number(e && e.header && e.header.compressedSize) || 0,
    isEncrypted: Boolean(e && e.header && (e.header.encripted || e.header.encrypted)),
  };
}

/**
 * @param {Buffer} buffer downloaded DOCX bytes
 * @param {object} [opts]
 * @param {(buf:Buffer)=>Array} [opts.parseEntries] zip entry reader (injectable)
 * @returns {{ok:boolean, code:string|null, entries:Array|null, parsed:boolean}}
 *   `entries` are the RAW parser entries (for the caller) only when ok.
 *   `parsed` is true iff the zip parser actually ran (false when a pre-parse
 *   gate short-circuited) — lets tests prove the guard runs before the parser.
 */
function inspectDocxBuffer(buffer, {parseEntries = defaultParseEntries} = {}) {
  if (!buffer || typeof buffer.length !== "number") {
    return {ok: false, code: "no_buffer", entries: null, parsed: false};
  }
  // Pre-parse gates — reject a non-zip or oversized container BEFORE parsing.
  if (buffer.length > LIMITS.maxUploadBytes) {
    return {ok: false, code: "archive_too_large", entries: null, parsed: false};
  }
  if (!looksLikeZip(buffer)) {
    return {ok: false, code: "not_zip", entries: null, parsed: false};
  }
  let raw;
  try {
    raw = parseEntries(buffer);
  } catch (_e) {
    return {ok: false, code: "malformed_zip", entries: null, parsed: true};
  }
  const list = Array.isArray(raw) ? raw : [];
  const verdict = assessArchive({
    bufferLength: buffer.length,
    entries: list.map(toMeta),
  });
  return {
    ok: verdict.ok,
    code: verdict.ok ? null : verdict.code,
    entries: verdict.ok ? list : null,
    parsed: true,
  };
}

module.exports = {inspectDocxBuffer, toMeta, defaultParseEntries, safeUserError};
