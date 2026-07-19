/**
 * Pure-logic tests for the assessment export pipeline core.
 * Run: node functions/assessmentExports/exportsCore.test.js
 */

const assert = require("node:assert");
const {
  computeSourceHash, EXPORT_TEMPLATE_VERSION, buildExportProjection,
} = require("./sourceHash");
const core = require("./exportsCore");
const {buildExportFilename} = require("./exportFilename");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const baseAssessment = {
  createdBy: "teacher-1",
  title: "End of Term Test",
  grade: "4",
  subject: "Mathematics",
  assessmentType: "end_of_term",
  term: "1",
  year: 2026,
  schoolName: "Lusaka Primary",
  coverInstructions: "Answer all questions.",
};
const baseQuestions = [
  {order: 1, type: "mcq", text: "2+2?", marks: 1, options: ["3", "4"], correctAnswer: 1},
  {order: 2, type: "short_answer", text: "Name a shape.", marks: 2, correctAnswer: "circle"},
];

// ── source hash determinism + sensitivity ──────────────────────────
test("hash is deterministic across field ordering", () => {
  const a1 = {...baseAssessment};
  const a2 = {year: 2026, title: "End of Term Test", grade: "4", subject: "Mathematics",
    assessmentType: "end_of_term", term: "1", createdBy: "teacher-1",
    schoolName: "Lusaka Primary", coverInstructions: "Answer all questions."};
  assert.strictEqual(computeSourceHash(a1, baseQuestions), computeSourceHash(a2, baseQuestions));
});

test("hash ignores non-render fields (createdAt / _id / view counts)", () => {
  const noisy = {...baseAssessment, createdAt: {toMillis: () => 123}, updatedAt: {toMillis: () => 456}, viewCount: 99};
  assert.strictEqual(computeSourceHash(baseAssessment, baseQuestions), computeSourceHash(noisy, baseQuestions));
});

test("changing a mark changes the hash", () => {
  const changed = baseQuestions.map((q, i) => i === 0 ? {...q, marks: 5} : q);
  assert.notStrictEqual(computeSourceHash(baseAssessment, baseQuestions), computeSourceHash(baseAssessment, changed));
});

test("changing an answer changes the hash (marking scheme)", () => {
  const changed = baseQuestions.map((q, i) => i === 1 ? {...q, correctAnswer: "square"} : q);
  assert.notStrictEqual(computeSourceHash(baseAssessment, baseQuestions), computeSourceHash(baseAssessment, changed));
});

test("reordering questions changes the hash", () => {
  const reordered = [{...baseQuestions[0], order: 2}, {...baseQuestions[1], order: 1}];
  assert.notStrictEqual(computeSourceHash(baseAssessment, baseQuestions), computeSourceHash(baseAssessment, reordered));
});

test("changing the header (school name) changes the hash", () => {
  assert.notStrictEqual(
    computeSourceHash(baseAssessment, baseQuestions),
    computeSourceHash({...baseAssessment, schoolName: "Ndola Primary"}, baseQuestions),
  );
});

test("changing instructions changes the hash", () => {
  assert.notStrictEqual(
    computeSourceHash(baseAssessment, baseQuestions),
    computeSourceHash({...baseAssessment, coverInstructions: "Use a pen."}, baseQuestions),
  );
});

test("changing a paper setting changes the hash", () => {
  assert.notStrictEqual(
    computeSourceHash(baseAssessment, baseQuestions),
    computeSourceHash({...baseAssessment, mcqAnswerChoiceCount: 3}, baseQuestions),
  );
});

test("template version is part of the projection", () => {
  assert.strictEqual(buildExportProjection(baseAssessment, baseQuestions).templateVersion, EXPORT_TEMPLATE_VERSION);
});

test("hash is a 32-char hex string", () => {
  const h = computeSourceHash(baseAssessment, baseQuestions);
  assert.match(h, /^[0-9a-f]{32}$/);
});

// ── export type resolution + content types ─────────────────────────
test("resolveExportType accepts the three known types", () => {
  assert.strictEqual(core.resolveExportType("paper-docx").format, "docx");
  assert.strictEqual(core.resolveExportType("paper-pdf").format, "pdf");
  assert.strictEqual(core.resolveExportType("scheme-docx").mode, "scheme");
});

test("resolveExportType rejects unknown / traversal types", () => {
  assert.strictEqual(core.resolveExportType("evil"), null);
  assert.strictEqual(core.resolveExportType("../secret"), null);
  assert.strictEqual(core.resolveExportType(""), null);
  assert.strictEqual(core.resolveExportType(undefined), null);
});

test("content types are correct", () => {
  assert.match(core.contentTypeForFormat("docx"), /wordprocessingml/);
  assert.strictEqual(core.contentTypeForFormat("pdf"), "application/pdf");
});

// ── storage path building + traversal rejection ────────────────────
test("buildStoragePath produces the versioned path", () => {
  const p = core.buildStoragePath("uid1", "asmt1", "abc123", "paper.docx");
  assert.strictEqual(p, "assessment-exports/uid1/asmt1/abc123/paper.docx");
});

test("buildStoragePath rejects traversal segments", () => {
  assert.throws(() => core.buildStoragePath("../etc", "a", "h", "paper.docx"));
  assert.throws(() => core.buildStoragePath("u", "a/b", "h", "paper.docx"));
  assert.throws(() => core.buildStoragePath("u", "a", "..", "paper.docx"));
  assert.throws(() => core.buildStoragePath("u", "a", "h", "../../secret"));
});

test("isSafeSegment blocks empties, slashes, dots", () => {
  assert.ok(core.isSafeSegment("abc-123_x.y"));
  assert.ok(!core.isSafeSegment(""));
  assert.ok(!core.isSafeSegment(".."));
  assert.ok(!core.isSafeSegment("a/b"));
  assert.ok(!core.isSafeSegment("a b"));
});

// ── request classification (cache / wait / generate) ───────────────
const HASH = "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh";
test("ready entry at the current hash → serve", () => {
  const r = core.classifyExportRequest({status: "ready", sourceHash: HASH, storagePath: "p"}, HASH, 1000);
  assert.strictEqual(r.action, "serve");
  assert.strictEqual(r.storagePath, "p");
});

test("ready entry at a stale hash → generate", () => {
  const r = core.classifyExportRequest({status: "ready", sourceHash: "OLD", storagePath: "p"}, HASH, 1000);
  assert.strictEqual(r.action, "generate");
});

test("live lease at the current hash → wait", () => {
  const r = core.classifyExportRequest({status: "generating", sourceHash: HASH, leaseExpiresAt: 5000}, HASH, 1000);
  assert.strictEqual(r.action, "wait");
});

test("expired lease → generate (reclaim)", () => {
  const r = core.classifyExportRequest({status: "generating", sourceHash: HASH, leaseExpiresAt: 500}, HASH, 1000);
  assert.strictEqual(r.action, "generate");
});

test("missing entry → generate", () => {
  assert.strictEqual(core.classifyExportRequest(undefined, HASH, 1000).action, "generate");
});

// ── lease claiming ─────────────────────────────────────────────────
test("canClaimLease: free when no live lease", () => {
  assert.ok(core.canClaimLease(undefined, 1000));
  assert.ok(core.canClaimLease({status: "ready"}, 1000));
  assert.ok(core.canClaimLease({status: "generating", leaseExpiresAt: 500}, 1000)); // expired
});

test("canClaimLease: refused while a live lease is held", () => {
  assert.ok(!core.canClaimLease({status: "generating", leaseExpiresAt: 5000}, 1000));
});

test("buildLeaseEntry increments attempts at same hash, resets at new hash", () => {
  const e1 = core.buildLeaseEntry({status: "failed", sourceHash: HASH, attemptCount: 2}, HASH, "own", 1000);
  assert.strictEqual(e1.attemptCount, 3);
  const e2 = core.buildLeaseEntry({status: "failed", sourceHash: "OLD", attemptCount: 2}, HASH, "own", 1000);
  assert.strictEqual(e2.attemptCount, 1);
});

test("buildLeaseEntry carries a previous ready object forward", () => {
  const e = core.buildLeaseEntry({status: "ready", sourceHash: "OLD", storagePath: "old/path"}, HASH, "own", 1000);
  assert.strictEqual(e.readyStoragePath, "old/path");
  assert.strictEqual(e.readySourceHash, "OLD");
});

// ── failure keeps the previous ready version usable ────────────────
test("buildFailedEntry falls back to the previous ready version", () => {
  const lease = core.buildLeaseEntry({status: "ready", sourceHash: "OLD", storagePath: "old/path"}, HASH, "own", 1000);
  const failed = core.buildFailedEntry(lease, HASH, "RENDER_ERROR");
  assert.strictEqual(failed.status, "ready", "old export stays usable");
  assert.strictEqual(failed.storagePath, "old/path");
  assert.strictEqual(failed.failedHash, HASH);
  assert.strictEqual(failed.failureCode, "RENDER_ERROR");
});

test("buildFailedEntry hard-fails when there was no previous ready version", () => {
  const lease = core.buildLeaseEntry(undefined, HASH, "own", 1000);
  const failed = core.buildFailedEntry(lease, HASH, "RENDER_ERROR");
  assert.strictEqual(failed.status, "failed");
  assert.strictEqual(failed.sourceHash, HASH);
});

test("isHardFailed only after attempts exhausted", () => {
  assert.ok(!core.isHardFailed({status: "failed", sourceHash: HASH, attemptCount: 1}, HASH));
  assert.ok(core.isHardFailed({status: "failed", sourceHash: HASH, attemptCount: core.MAX_ATTEMPTS}, HASH));
});

// ── authorization ──────────────────────────────────────────────────
test("owner is authorised", () => {
  assert.deepStrictEqual(core.authorizeAssessmentAccess({assessment: {createdBy: "u"}, uid: "u"}), {ok: true});
});
test("admin is authorised for any assessment", () => {
  assert.deepStrictEqual(core.authorizeAssessmentAccess({assessment: {createdBy: "other"}, uid: "admin", isAdmin: true}), {ok: true});
});
test("a different teacher is forbidden (403)", () => {
  const r = core.authorizeAssessmentAccess({assessment: {createdBy: "owner"}, uid: "intruder"});
  assert.strictEqual(r.ok, false);
  assert.strictEqual(core.httpStatusForCode(r.code), 403);
});
test("no uid is unauthenticated (401)", () => {
  const r = core.authorizeAssessmentAccess({assessment: {createdBy: "owner"}, uid: null});
  assert.strictEqual(core.httpStatusForCode(r.code), 401);
});
test("missing / deleted assessment is not-found (404)", () => {
  assert.strictEqual(core.httpStatusForCode(core.authorizeAssessmentAccess({assessment: null, uid: "u"}).code), 404);
  assert.strictEqual(core.httpStatusForCode(core.authorizeAssessmentAccess({assessment: {createdBy: "u", deleted: true}, uid: "u"}).code), 404);
});

// ── filenames ──────────────────────────────────────────────────────
test("filename matches the professional format", () => {
  assert.strictEqual(buildExportFilename(baseAssessment, "docx", "paper"), "GRADE_4_END_OF_TERM_1_TEST_2026.docx");
});
test("scheme filename carries MARKING_KEY", () => {
  assert.strictEqual(buildExportFilename(baseAssessment, "docx", "scheme"), "GRADE_4_END_OF_TERM_1_TEST_2026_MARKING_KEY.docx");
});
test("pdf filename carries the pdf extension", () => {
  assert.strictEqual(buildExportFilename(baseAssessment, "pdf", "paper"), "GRADE_4_END_OF_TERM_1_TEST_2026.pdf");
});
test("filename never empty / never contains path chars", () => {
  const f = buildExportFilename({}, "docx", "paper");
  assert.ok(f.length > 4);
  assert.ok(!/[\\/]/.test(f));
});

console.log(`\nexportsCore: ${passed} tests passed`);
