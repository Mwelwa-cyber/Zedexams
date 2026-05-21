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
  collectLessonPaths,
  collectLessonPrefixes,
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

console.log(`\n${passed} assertions passed`);
