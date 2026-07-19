/**
 * Node test for the DOCX/ZIP archive guard (SEC-007). Pure — no adm-zip, no
 * firebase — so it runs under the repo's root-only test install.
 * Run: node functions/teacherTools/docxArchiveGuard.test.js
 *
 * Verifies rejection happens on ARCHIVE METADATA (entry headers + buffer
 * size), i.e. before any decompression — the key property that makes the
 * zip-bomb defence effective. Synthetic entry lists stand in for a parsed
 * archive; no dangerous archive is ever built or decompressed.
 */

const assert = require("node:assert");
const {
  LIMITS,
  DOCX_SIGNATURE_ENTRY,
  looksLikeZip,
  isUnsafePath,
  assessArchive,
  safeUserError,
} = require("./docxArchiveGuard");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("docxArchiveGuard");

// ── looksLikeZip (magic bytes) ─────────────────────────────────────────────
ok("PK\\x03\\x04 local header → looks like zip",
  looksLikeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])) === true);
ok("PK\\x05\\x06 empty archive → looks like zip",
  looksLikeZip(Buffer.from([0x50, 0x4b, 0x05, 0x06])) === true);
ok("PDF magic (%PDF) → not a zip",
  looksLikeZip(Buffer.from("%PDF-1.7")) === false);
ok("random bytes → not a zip",
  looksLikeZip(Buffer.from([0x00, 0x01, 0x02, 0x03])) === false);
ok("too-short buffer → not a zip", looksLikeZip(Buffer.from([0x50])) === false);
ok("null buffer → not a zip", looksLikeZip(null) === false);

// ── isUnsafePath ───────────────────────────────────────────────────────────
ok("normal part path is safe", isUnsafePath("word/media/image1.png") === null);
ok("absolute posix path rejected", isUnsafePath("/etc/passwd") === "absolute_path");
ok("windows drive path rejected", isUnsafePath("C:\\evil.dll") === "absolute_path");
ok("traversal rejected", isUnsafePath("word/../../secret") === "path_traversal");
ok("over-long name rejected",
  isUnsafePath("a/".repeat(200)) === "entry_name_too_long");

// ── assessArchive: the happy path ──────────────────────────────────────────
function validDocxEntries(extra = []) {
  return [
    {name: DOCX_SIGNATURE_ENTRY, uncompressedSize: 1200, compressedSize: 400},
    {name: "word/document.xml", uncompressedSize: 40000, compressedSize: 6000},
    {name: "word/_rels/document.xml.rels", uncompressedSize: 800, compressedSize: 300},
    {name: "word/media/image1.png", uncompressedSize: 60 * 1024, compressedSize: 58 * 1024},
    ...extra,
  ];
}
{
  const v = assessArchive({bufferLength: 200 * 1024, entries: validDocxEntries()});
  ok("a normal small DOCX passes", v.ok === true);

  const big = assessArchive({
    bufferLength: LIMITS.maxUploadBytes, // exactly at the cap
    entries: validDocxEntries(),
  });
  ok("a DOCX exactly at the size cap passes", big.ok === true);
}

// ── assessArchive: rejections (each returns a stable code, first wins) ─────
function reject(name, patch, expectedCode) {
  const entries = patch.entries || validDocxEntries();
  const bufferLength = patch.bufferLength != null ? patch.bufferLength : 200 * 1024;
  const v = assessArchive({bufferLength, entries, limits: patch.limits});
  ok(`${name} → ${expectedCode}`, v.ok === false && v.code === expectedCode);
}

reject("oversized compressed archive", {bufferLength: LIMITS.maxUploadBytes + 1}, "archive_too_large");
reject("excessive entry count",
  {entries: [
    ...validDocxEntries(),
    ...Array.from({length: LIMITS.maxEntries}, (_, i) =>
      ({name: `word/media/x${i}.png`, uncompressedSize: 10, compressedSize: 10})),
  ]},
  "too_many_entries");
reject("fake .docx (no [Content_Types].xml)",
  {entries: [{name: "word/media/image1.png", uncompressedSize: 100, compressedSize: 50}]},
  "not_a_docx");
reject("oversized single entry (uncompressed)",
  {entries: validDocxEntries([
    {name: "word/media/huge.png",
      uncompressedSize: LIMITS.maxEntryUncompressedBytes + 1,
      compressedSize: 1000},
  ])},
  "entry_too_large");
reject("compression bomb (extreme ratio)",
  {entries: validDocxEntries([
    // 10MB claimed from 1KB compressed = ratio ~10000, well over the cap.
    {name: "word/media/bomb.bin",
      uncompressedSize: 10 * 1024 * 1024, compressedSize: 1024},
  ])},
  "compression_bomb");
reject("total uncompressed over cap",
  {entries: [
    {name: DOCX_SIGNATURE_ENTRY, uncompressedSize: 100, compressedSize: 100},
    // Many entries each just under the per-entry cap, summing over the total.
    ...Array.from({length: 30}, (_, i) =>
      ({name: `word/media/p${i}.png`,
        uncompressedSize: 10 * 1024 * 1024, compressedSize: 9 * 1024 * 1024})),
  ]},
  "total_too_large");
reject("path traversal entry",
  {entries: validDocxEntries([
    {name: "../../etc/passwd", uncompressedSize: 100, compressedSize: 50}])},
  "path_traversal");
reject("absolute-path entry",
  {entries: validDocxEntries([
    {name: "/root/.ssh/id_rsa", uncompressedSize: 100, compressedSize: 50}])},
  "absolute_path");
reject("duplicate entry names",
  {entries: validDocxEntries([
    {name: "word/media/image1.png", uncompressedSize: 60 * 1024, compressedSize: 58 * 1024}])},
  "duplicate_entry");
reject("encrypted entry",
  {entries: validDocxEntries([
    {name: "word/media/enc.png", uncompressedSize: 100, compressedSize: 50, isEncrypted: true}])},
  "encrypted_entry");

// ── safeUserError leaks nothing internal ───────────────────────────────────
{
  const msg = safeUserError();
  ok("user error is generic (no code/threshold/dependency/stack leak)",
    /could not be processed/i.test(msg) &&
    !/adm-zip|compression_bomb|byte|ratio|\d{3,}/.test(msg));
}

// Directory records carry no payload and must not trip size checks.
{
  const v = assessArchive({
    bufferLength: 50 * 1024,
    entries: [
      {name: DOCX_SIGNATURE_ENTRY, uncompressedSize: 100, compressedSize: 100},
      {name: "word/", isDirectory: true, uncompressedSize: 0, compressedSize: 0},
      {name: "word/media/image1.png", uncompressedSize: 40 * 1024, compressedSize: 39 * 1024},
    ],
  });
  ok("directory entries are tolerated", v.ok === true);
}

console.log(`docxArchiveGuard: ${passed} checks passed`);
