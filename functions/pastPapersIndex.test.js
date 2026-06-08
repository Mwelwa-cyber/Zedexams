/**
 * Node test for the past-papers index helpers.
 * Run: node functions/pastPapersIndex.test.js
 *
 * Focus: the rebuild-guard logic. The trigger must NOT rebuild the
 * index on view/download counter bumps or draft asset churn (the common,
 * high-frequency writes), and MUST rebuild on anything that changes the
 * published list. lightEntry must emit a clean, undefined-free shape.
 */

const assert = require("node:assert");
const {lightEntry, lightSignature} = require("./pastPapersIndexHelpers");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("pastPapersIndex");

// ── lightEntry: clean lightweight shape ──────────────────────────────────
const full = lightEntry("p1", {
  title: "Grade 7 Maths 2023",
  grade: "7",
  subject: "mathematics",
  year: 2023,
  quizId: "q1",
  specimen: false,
  examBoard: "ECZ",
  paperNumber: 1,
  // heavy / irrelevant fields that must NOT leak into the index:
  assets: [{path: "a"}, {path: "b"}],
  views: 999,
  downloads: 42,
  uploadedBy: "admin1",
});
ok("lightEntry keeps id", full.id === "p1");
ok("lightEntry keeps title", full.title === "Grade 7 Maths 2023");
ok("lightEntry keeps grade as string", full.grade === "7");
ok("lightEntry keeps year as number", full.year === 2023);
ok("lightEntry keeps quizId", full.quizId === "q1");
ok("lightEntry keeps paperNumber", full.paperNumber === 1);
ok("lightEntry drops assets", !("assets" in full));
ok("lightEntry drops views/downloads",
  !("views" in full) && !("downloads" in full));
ok("lightEntry has no undefined values",
  Object.values(full).every((v) => v !== undefined));

// Numeric grade coerces to string; missing optionals normalise to null/default.
const sparse = lightEntry("p2", {title: "Untitled", grade: 12, year: "nope"});
ok("lightEntry coerces numeric grade to string", sparse.grade === "12");
ok("lightEntry nulls non-numeric year", sparse.year === null);
ok("lightEntry defaults examBoard to ECZ", sparse.examBoard === "ECZ");
ok("lightEntry omits absent paperNumber", !("paperNumber" in sparse));
ok("lightEntry defaults specimen to false", sparse.specimen === false);

// ── lightSignature: change detection drives the rebuild guard ────────────
const published = {
  status: "published", title: "T", grade: "7", subject: "english",
  year: 2024, quizId: null, specimen: false, examBoard: "ECZ",
};

// A view/download bump leaves every light field untouched → no rebuild.
const afterCounterBump = {...published, views: 5, downloads: 2, updatedAt: 123};
ok("counter bump leaves signature unchanged",
  lightSignature(published) === lightSignature(afterCounterBump));

// An assets[] edit (reorder / role change) likewise → no rebuild.
const afterAssetsEdit = {...published, assets: [{path: "x", role: "mark-scheme"}]};
ok("assets edit leaves signature unchanged",
  lightSignature(published) === lightSignature(afterAssetsEdit));

// A title edit on a published paper → rebuild.
ok("title edit changes signature",
  lightSignature(published) !== lightSignature({...published, title: "T2"}));

// Publishing a draft → rebuild.
ok("status flip changes signature",
  lightSignature({...published, status: "draft"}) !== lightSignature(published));

// Linking a quiz → rebuild (the hub shows a "Quiz available" badge).
ok("quizId change changes signature",
  lightSignature(published) !== lightSignature({...published, quizId: "q9"}));

// Null/absent doc (create or delete edges) is stable + distinct from data.
ok("absent doc signature is stable",
  lightSignature(null) === lightSignature(undefined));
ok("absent doc differs from a real doc",
  lightSignature(null) !== lightSignature(published));

console.log(`\n${passed} passed`);
