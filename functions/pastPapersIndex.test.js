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
const {
  KNOWN_SOURCES,
  OFFICIAL_SOURCES,
  deriveQuizStatus,
  lightEntry,
  lightSignature,
} = require("./pastPapersIndexHelpers");

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
  slug: "grade-7-mathematics-2023-paper-1",
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
ok("lightEntry keeps slug when present",
  full.slug === "grade-7-mathematics-2023-paper-1");
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
ok("lightEntry omits absent slug", !("slug" in sparse));
ok("lightEntry defaults specimen to false", sparse.specimen === false);

// ── quizStatus: mirrors src/utils/pastPaperQuizStatus.js ─────────────────
// The Quiz step of the Studio is optional, so the index has to say whether a
// published paper's quiz is actually there. These cases are the same ones
// src/utils/pastPaperQuizStatus.test.js pins on the frontend copy — if the two
// derivations drift, the hub badges a paper the viewer says is pending.
ok("legacy paper with a quizId derives attached",
  deriveQuizStatus({quizId: "q1"}) === "attached");
ok("legacy paper with no quizId derives pending",
  deriveQuizStatus({title: "old"}) === "pending");
ok("stated pending wins over a lingering quizId",
  deriveQuizStatus({quizStatus: "pending", quizId: "q1"}) === "pending");
ok("stated attached with no quizId falls back to pending",
  deriveQuizStatus({quizStatus: "attached", quizId: null}) === "pending");
ok("a junk status falls back to the quizId signal",
  deriveQuizStatus({quizStatus: "ready", quizId: "q1"}) === "attached");

ok("lightEntry carries an attached quiz status",
  full.quizStatus === "attached");
const pendingEntry = lightEntry("p3", {
  title: "Grade 12 Biology 2024",
  grade: "12",
  year: 2024,
  quizStatus: "pending",
  // A pending paper parks its draft quiz id on the doc; the index must not
  // republish it as `quizId` or the hub renders a live "Take quiz" button
  // pointing at a quiz with no questions in it.
  quizId: "draft-q",
  pendingQuizId: "draft-q",
});
ok("lightEntry marks a skipped paper pending",
  pendingEntry.quizStatus === "pending");
ok("lightEntry withholds the quizId of a pending paper",
  pendingEntry.quizId === null);
ok("lightEntry never leaks pendingQuizId to the hub",
  !("pendingQuizId" in pendingEntry));
ok("lightEntry defaults an old paper with no quiz to pending",
  sparse.quizStatus === "pending" && sparse.quizId === null);

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

// Attaching a quiz to a paper published with the step skipped → rebuild, so
// the hub's badge flips without waiting for the 6-hourly cron.
ok("quizStatus change changes signature",
  lightSignature({...published, quizStatus: "pending"}) !==
    lightSignature({...published, quizStatus: "attached"}));

// A doc gaining/changing its SEO slug → rebuild, so the archive picks it up.
ok("slug change changes signature",
  lightSignature(published) !==
    lightSignature({...published, slug: "grade-7-english-2024"}));

// Null/absent doc (create or delete edges) is stable + distinct from data.
ok("absent doc signature is stable",
  lightSignature(null) === lightSignature(undefined));
ok("absent doc differs from a real doc",
  lightSignature(null) !== lightSignature(published));

// ── Source labelling ─────────────────────────────────────────────────────
//
// The index doc is world-readable in ONE piece, so whatever lands in it is
// published regardless of the per-document read rule. These assertions are
// therefore the same acceptance criterion as the rules test, applied to the
// build step.

const labelled = {
  status: "published", source: "ecz", sourceConfidence: "explicit",
  grade: "7", subject: "mathematics", year: 2023,
};

ok("lightEntry carries the source, the derived official flag and the session",
  lightEntry("p9", {...labelled, session: "october"}).source === "ecz" &&
  lightEntry("p9", {...labelled, session: "october"}).isOfficial === true &&
  lightEntry("p9", {...labelled, session: "october"}).session === "october");
ok("lightEntry re-derives isOfficial rather than copying a stored boolean",
  // A document whose two fields disagree must not publish a mock as official.
  lightEntry("p9", {...labelled, source: "prisca", isOfficial: true}).isOfficial === false);
ok("labelling a paper changes the signature, so the trigger rebuilds",
  lightSignature({...labelled, source: null, sourceConfidence: "unknown"}) !==
    lightSignature(labelled));

// ── Mirror check against the real registry ───────────────────────────────
// KNOWN_SOURCES / OFFICIAL_SOURCES are hand-copies of src/config/paperSources.js
// (ESM under src/, CommonJS here). A source added there and forgotten here
// would silently drop every paper of that source out of the public index, so
// the copies are asserted against the original rather than trusted.
(async () => {
  const registry = await import("../src/config/paperSources.js");
  const ids = Object.keys(registry.PAPER_SOURCES).sort();
  ok("KNOWN_SOURCES mirrors PAPER_SOURCES",
    JSON.stringify([...KNOWN_SOURCES].sort()) === JSON.stringify(ids));
  ok("OFFICIAL_SOURCES mirrors the registry's isOfficial flags",
    JSON.stringify([...OFFICIAL_SOURCES].sort()) === JSON.stringify(
      ids.filter((id) => registry.PAPER_SOURCES[id].isOfficial).sort()));
  console.log(`\n${passed} passed`);
})();
