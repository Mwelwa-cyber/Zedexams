/**
 * Node test for the shared guard-before-decompression DOCX inspector.
 * Run: node functions/teacherTools/docxArchiveInspect.test.js
 *
 * Root-install-safe: the zip parser is injected, so no adm-zip is required.
 * Proves the key SEC-007 property — the archive guard runs BEFORE the parser
 * decompresses/reads entries — by asserting the injected parser spy is not
 * called when a pre-parse gate (magic bytes / size) short-circuits, and that
 * bomb / traversal / bad-signature archives are rejected on entry METADATA.
 */

const assert = require("node:assert");
const {inspectDocxBuffer, toMeta} = require("./docxArchiveInspect");
const {DOCX_SIGNATURE_ENTRY, LIMITS} = require("./docxArchiveGuard");

let passed = 0;
function ok(name, cond) { assert.ok(cond, name); passed += 1; console.log(`  ok  ${name}`); }

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]); // "PK\x03\x04…"

// adm-zip-shaped raw entry factory (what parseEntries returns in prod).
function raw(name, unc = 1000, comp = 500, extra = {}) {
  return {entryName: name, isDirectory: Boolean(extra.dir), header: {
    size: unc, compressedSize: comp, encripted: Boolean(extra.enc)}};
}
function validRaw(extra = []) {
  return [
    raw(DOCX_SIGNATURE_ENTRY, 1200, 400),
    raw("word/document.xml", 40000, 6000),
    raw("word/media/image1.png", 60 * 1024, 58 * 1024),
    ...extra,
  ];
}

console.log("docxArchiveInspect");

// ── Guard runs BEFORE the parser (spy must NOT be called) ──────────────────
{
  let called = 0;
  const spy = () => { called++; return validRaw(); };

  const notZip = inspectDocxBuffer(Buffer.from("%PDF-1.7"), {parseEntries: spy});
  ok("non-zip rejected as not_zip", !notZip.ok && notZip.code === "not_zip");
  ok("parser NOT called for a non-zip buffer (guard before parse)", called === 0);
  ok("not_zip short-circuits before parsing", notZip.parsed === false);

  const huge = Buffer.alloc(0);
  Object.defineProperty(huge, "length", {value: LIMITS.maxUploadBytes + 1});
  const over = inspectDocxBuffer(huge, {parseEntries: spy});
  ok("oversized buffer rejected before parse", !over.ok && over.code === "archive_too_large" && over.parsed === false);
  ok("parser still not called after the size gate", called === 0);
}

// ── Valid DOCX passes and returns the raw entries for the caller ───────────
{
  const res = inspectDocxBuffer(ZIP, {parseEntries: () => validRaw()});
  ok("valid docx → ok with parsed=true", res.ok && res.parsed === true);
  ok("valid docx returns the raw entries for the caller",
    Array.isArray(res.entries) && res.entries.length === 3);
}

// ── Rejections happen on METADATA (before any getData decompression) ───────
function rejectCase(name, entries, code) {
  const res = inspectDocxBuffer(ZIP, {parseEntries: () => entries});
  ok(`${name} → ${code} (rejected on metadata, entries withheld)`,
    !res.ok && res.code === code && res.entries === null && res.parsed === true);
}
rejectCase("compression bomb",
  validRaw([raw("word/media/bomb.bin", 10 * 1024 * 1024, 1024)]), "compression_bomb");
rejectCase("excessive entry count",
  [raw(DOCX_SIGNATURE_ENTRY), ...Array.from({length: LIMITS.maxEntries + 1},
    (_, i) => raw(`word/media/x${i}.png`, 10, 10))], "too_many_entries");
rejectCase("path traversal",
  validRaw([raw("../../etc/passwd", 100, 50)]), "path_traversal");
rejectCase("fake .docx (missing signature)",
  [raw("word/media/image1.png", 100, 50)], "not_a_docx");
rejectCase("encrypted entry",
  validRaw([raw("word/media/e.png", 100, 50, {enc: true})]), "encrypted_entry");

// ── Malformed archive (parser throws) is rejected safely ───────────────────
{
  const res = inspectDocxBuffer(ZIP, {parseEntries: () => { throw new Error("bad central dir"); }});
  ok("parser throwing → malformed_zip (no crash)",
    !res.ok && res.code === "malformed_zip" && res.entries === null);
}

// ── toMeta maps adm-zip entry shape correctly ──────────────────────────────
{
  const m = toMeta(raw("word/media/i.png", 2048, 512, {enc: true}));
  ok("toMeta normalizes name/sizes/encrypted",
    m.name === "word/media/i.png" && m.uncompressedSize === 2048 &&
    m.compressedSize === 512 && m.isEncrypted === true);
}

console.log(`docxArchiveInspect: ${passed} checks passed`);
