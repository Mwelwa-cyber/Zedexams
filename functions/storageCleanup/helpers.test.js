/**
 * Tests for the storage-cleanup helpers. The triggers themselves need the
 * Firestore + Storage emulators to exercise, but the pure helpers are
 * worth pinning down — they're what decide which blobs get deleted.
 *
 * Run: node functions/storageCleanup/helpers.test.js
 */

const assert = require("node:assert");
const {
  parseStoragePathFromUrl,
  collectQuestionImagePaths,
  collectLivePathsFromQuestions,
  collectLessonPaths,
  collectLessonPrefixes,
  collectPaperPaths,
  collectUserPrefixes,
  deleteByPrefixCounted,
  USER_KEYED_PREFIXES,
} = require("./helpers");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
function eq(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

const BUCKET = "zedexams.appspot.com";

console.log("parseStoragePathFromUrl");

eq("decodes a getDownloadURL token URL",
  parseStoragePathFromUrl(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/quiz-images%2Fuid123%2Fimg.png?alt=media&token=abc`,
    BUCKET,
  ),
  "quiz-images/uid123/img.png");

eq("decodes a multi-segment encoded path",
  parseStoragePathFromUrl(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/lesson-presentations%2Fuid%2Fbatch%2Fslides%2Fslide-001.png?alt=media&token=x`,
    BUCKET,
  ),
  "lesson-presentations/uid/batch/slides/slide-001.png");

eq("decodes a getSignedUrl URL (storage.googleapis.com host)",
  parseStoragePathFromUrl(
    `https://storage.googleapis.com/${BUCKET}/assessment-images/uid/diagrams/1700000000000.png?GoogleAccessId=foo&Expires=1&Signature=bar`,
    BUCKET,
  ),
  "assessment-images/uid/diagrams/1700000000000.png");

eq("decodes a gs:// URI",
  parseStoragePathFromUrl(`gs://${BUCKET}/quiz-images/uid/img.png`, BUCKET),
  "quiz-images/uid/img.png");

ok("returns null for a foreign bucket",
  parseStoragePathFromUrl(
    `https://firebasestorage.googleapis.com/v0/b/some-other-bucket/o/quiz-images%2Fuid%2Fimg.png?alt=media`,
    BUCKET,
  ) === null);

ok("returns null for an unrelated URL",
  parseStoragePathFromUrl("https://example.com/some.png", BUCKET) === null);

ok("returns null for empty / nullish input",
  parseStoragePathFromUrl(null, BUCKET) === null &&
  parseStoragePathFromUrl("", BUCKET) === null &&
  parseStoragePathFromUrl(undefined, BUCKET) === null);

ok("accepts when bucketName is omitted",
  parseStoragePathFromUrl(
    `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/x%2Fy.png?alt=media`,
  ) === "x/y.png");

console.log("\ncollectQuestionImagePaths");

eq("collects imageUrl + optionMedia",
  collectQuestionImagePaths({
    imageUrl:
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/quiz-images%2Fuid%2Fmain.png?alt=media&token=x`,
    optionMedia: [
      null,
      {
        imageUrl:
          `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/quiz-images%2Fuid%2Fopt-b.png?alt=media`,
      },
      {imageUrl: null},
      {
        imageUrl:
          `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/quiz-images%2Fuid%2Fopt-d.png?alt=media`,
      },
    ],
  }, BUCKET).sort(),
  [
    "quiz-images/uid/main.png",
    "quiz-images/uid/opt-b.png",
    "quiz-images/uid/opt-d.png",
  ]);

eq("collects stacked images[] urls beyond the primary",
  collectQuestionImagePaths({
    imageUrl:
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/assessment-images%2Fuid%2Fmain.png?alt=media`,
    images: [
      {url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/assessment-images%2Fuid%2Fextra-1.png?alt=media`},
      null,
      {url: null},
      {url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/assessment-images%2Fuid%2Fextra-2.png?alt=media`},
    ],
  }, BUCKET).sort(),
  [
    "assessment-images/uid/extra-1.png",
    "assessment-images/uid/extra-2.png",
    "assessment-images/uid/main.png",
  ]);

eq("deduplicates when same URL appears on main + option",
  collectQuestionImagePaths({
    imageUrl:
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/q.png?alt=media`,
    optionMedia: [{
      imageUrl:
        `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/q.png?alt=media`,
    }],
  }, BUCKET),
  ["q.png"]);

eq("ignores library diagram refs (no imageUrl)",
  collectQuestionImagePaths({
    imageDiagram: {libraryKey: "human-skin", params: {}},
    optionMedia: [{diagram: {libraryKey: "leaf", params: {}}}],
  }, BUCKET),
  []);

eq("handles empty / missing fields",
  collectQuestionImagePaths(null, BUCKET), []);

eq("collects passage-level imageUrl",
  collectQuestionImagePaths({
    passage: {
      imageUrl:
        `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/passage.png?alt=media`,
    },
  }, BUCKET),
  ["passage.png"]);

console.log("\ncollectLivePathsFromQuestions (sibling-reference guard)");

const urlFor = (name) =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/` +
  `quiz-images%2Fuid%2F${name}?alt=media&token=x`;

eq("unions paths across sibling questions, deduped",
  [...collectLivePathsFromQuestions([
    {imageUrl: urlFor("a.png")},
    {optionMedia: [{imageUrl: urlFor("b.png")}]},
    {imageUrl: urlFor("a.png")}, // duplicate ref to a.png
    null,
  ], BUCKET)].sort(),
  ["quiz-images/uid/a.png", "quiz-images/uid/b.png"]);

eq("empty for no siblings / all text-only",
  [...collectLivePathsFromQuestions(
    [null, {options: ["x"]}, {}], BUCKET)],
  []);

// The regression this whole change exists for: a duplicate question doc is
// deleted, but the SURVIVING sibling still references the same blob — so the
// shared image must NOT be deleted. The trigger computes
// `candidatePaths.filter((p) => !live.has(p))`; assert that filter is empty
// when the survivor keeps the path.
{
  const shared = urlFor("shared-figure.png");
  const deletedDoc = {imageUrl: shared};
  const survivingSibling = {imageUrl: shared};
  const candidates = collectQuestionImagePaths(deletedDoc, BUCKET);
  const live = collectLivePathsFromQuestions([survivingSibling], BUCKET);
  const toDelete = candidates.filter((p) => !live.has(p));
  eq("shared image is KEPT when a sibling still references it",
    toDelete, []);
}

// Control: a blob referenced ONLY by the deleted question (no sibling holds it)
// is still collected for deletion.
{
  const orphanOnly = urlFor("only-here.png");
  const deletedDoc = {imageUrl: orphanOnly};
  const survivingSibling = {imageUrl: urlFor("different.png")};
  const candidates = collectQuestionImagePaths(deletedDoc, BUCKET);
  const live = collectLivePathsFromQuestions([survivingSibling], BUCKET);
  const toDelete = candidates.filter((p) => !live.has(p));
  eq("unshared image is still deleted",
    toDelete, ["quiz-images/uid/only-here.png"]);
}

console.log("\ncollectLessonPaths + collectLessonPrefixes");

eq("collects file-note storagePath",
  collectLessonPaths({storagePath: "lesson-files/uid/batch/file.pdf"}, BUCKET),
  ["lesson-files/uid/batch/file.pdf"]);

eq("collects pptx source + slide image storagePaths",
  collectLessonPaths({
    presentation: {
      sourcePath: "lesson-presentations/uid/batch/source/deck.pptx",
      slideImages: [
        {storagePath: "lesson-presentations/uid/batch/slides/slide-001.png"},
        {storagePath: "lesson-presentations/uid/batch/slides/slide-002.png"},
        null,
        {storagePath: ""},
      ],
    },
  }, BUCKET).sort(),
  [
    "lesson-presentations/uid/batch/slides/slide-001.png",
    "lesson-presentations/uid/batch/slides/slide-002.png",
    "lesson-presentations/uid/batch/source/deck.pptx",
  ]);

eq("collects slide-builder slides[].imageStoragePath",
  collectLessonPaths({
    slides: [
      {imageStoragePath: "lesson-files/uid/batch/slide-a.png"},
      {imageUrl: `gs://${BUCKET}/lesson-files/uid/batch/slide-b.png`},
      {imageStoragePath: "", imageUrl: ""},
    ],
  }, BUCKET).sort(),
  [
    "lesson-files/uid/batch/slide-a.png",
    "lesson-files/uid/batch/slide-b.png",
  ]);

eq("collectLessonPrefixes returns both batch folders",
  collectLessonPrefixes({createdBy: "uid", assetBatchId: "batch"}),
  ["lesson-files/uid/batch/", "lesson-presentations/uid/batch/"]);

eq("collectLessonPrefixes returns empty when batch info is missing",
  collectLessonPrefixes({createdBy: "uid"}),
  []);

console.log("\ncollectPaperPaths");

eq("collects pdfPath + markSchemePath",
  collectPaperPaths({
    pdfPath: "papers/uid/abc/paper-2024.pdf",
    markSchemePath: "papers/uid/abc/mark-scheme-2024.pdf",
  }).sort(),
  [
    "papers/uid/abc/mark-scheme-2024.pdf",
    "papers/uid/abc/paper-2024.pdf",
  ]);

eq("collectPaperPaths dedupes when both fields are identical",
  collectPaperPaths({
    pdfPath: "papers/uid/abc/paper.pdf",
    markSchemePath: "papers/uid/abc/paper.pdf",
  }),
  ["papers/uid/abc/paper.pdf"]);

eq("collectPaperPaths returns empty for null / missing fields",
  collectPaperPaths(null), []);

console.log("\ncollectUserPrefixes");

eq("emits one prefix per user-keyed top folder",
  collectUserPrefixes("alice").sort(),
  [
    "assessment-exports/alice/",
    "assessment-format-samples/alice/",
    "assessment-images/alice/",
    "curriculum-uploads/alice/",
    "invoices/alice/",
    "lesson-files/alice/",
    "lesson-images/alice/",
    "lesson-presentations/alice/",
    "note-pictures/alice/",
    "papers/alice/",
    "quiz-images/alice/",
    "slide-notes-images/alice/",
    "tmp-downloads/alice/",
    "user-branding/alice/",
    "visual-studio/alice/",
  ]);

eq("collectUserPrefixes returns empty for a missing uid",
  collectUserPrefixes(""), []);

ok("USER_KEYED_PREFIXES is the source of truth, frozen",
  Object.isFrozen(USER_KEYED_PREFIXES) &&
  USER_KEYED_PREFIXES.length === 15);

ok("user-branding/ (Teacher Settings assets) is swept on account deletion",
  USER_KEYED_PREFIXES.includes("user-branding/"));

ok("visual-studio/ (baked diagrams) is swept on account deletion",
  USER_KEYED_PREFIXES.includes("visual-studio/"));

ok("note-pictures/ + slide-notes-images/ (server-gen AI images) are swept",
  USER_KEYED_PREFIXES.includes("note-pictures/") &&
  USER_KEYED_PREFIXES.includes("slide-notes-images/"));

ok("syllabi/ is NOT user-keyed (admin-owned global content)",
  !USER_KEYED_PREFIXES.includes("syllabi/"));

// Added with the post-deletion Storage re-sweep. Each of these is
// `{prefix}/{ownerUid}/…` in storage.rules and was swept by nothing, so the
// objects outlived the account they belonged to.
ok("tmp-downloads/ (export staging) is swept on account deletion",
  USER_KEYED_PREFIXES.includes("tmp-downloads/"));

ok("curriculum-uploads/ + assessment-format-samples/ (teacher uploads) are swept",
  USER_KEYED_PREFIXES.includes("curriculum-uploads/") &&
  USER_KEYED_PREFIXES.includes("assessment-format-samples/"));

ok("assessment-exports/ (cached paper renders) is swept",
  USER_KEYED_PREFIXES.includes("assessment-exports/"));

console.log("\ndeleteByPrefixCounted");

// The re-sweep exists on a hypothesis — that an ID token outliving its account
// is used to upload before it expires. Without the count, a run that cleared a
// real leak and a run that found an empty bucket are the same log line, so the
// mechanism would never produce evidence about its own premise.
// CommonJS module: no top-level await, so the async block runs last and owns
// the final tally.
async function testDeleteByPrefixCounted() {
  const listed = [];
  const deleted = [];
  const bucket = {
    async getFiles({prefix}) {
      listed.push(prefix);
      return [prefix === "papers/u1/" ? [{}, {}, {}] : []];
    },
    async deleteFiles({prefix}) { deleted.push(prefix); },
  };
  eq("counts what it removed", await deleteByPrefixCounted(bucket, "papers/u1/"), 3);
  eq("an empty prefix reports zero", await deleteByPrefixCounted(bucket, "papers/u2/"), 0);
  eq("and issues no delete for an empty prefix", deleted, ["papers/u1/"]);
  eq("both prefixes were still enumerated", listed, ["papers/u1/", "papers/u2/"]);
  eq("a missing bucket or prefix is zero, not a throw",
    await deleteByPrefixCounted(null, "papers/u1/"), 0);

  // THROWS rather than warning, unlike deleteByPrefix. Its caller has to leave
  // the job open and retry; a swallowed error would be indistinguishable from
  // "nothing was there", which is the exact conflation the count removes.
  let threw = false;
  try {
    await deleteByPrefixCounted({
      async getFiles() { throw new Error("listing failed"); },
    }, "papers/u3/");
  } catch (_err) {
    threw = true;
  }
  ok("a listing failure propagates rather than reading as an empty prefix", threw);
}

testDeleteByPrefixCounted().then(() => {
  console.log(`\n${passed} assertions passed`);
});
