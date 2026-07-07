/**
 * Unit tests for the scheme-of-work quality checklist (pure rules).
 * Plain node: `node functions/teacherTools/schemeQualityCheck.test.js`
 */

const assert = require("node:assert/strict");
const {buildSchemeQualityChecks} = require("./schemeQualityCheck");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}

function check(result, code) {
  const c = result.checks.find((x) => x.code === code);
  assert.ok(c, `check "${code}" exists`);
  return c;
}

/** A clean 5-week CBC scheme in the spec's shape (content → revision → exam). */
function goodCbcScheme() {
  const contentWeek = (week, cont) => ({
    week,
    topic: "4.1 SETS",
    subtopic: `4.1.1 Operations on Sets${cont ? " (cont.)" : ""}`,
    specificCompetences: ["4.1.1.1 Apply set operations in everyday life"],
    learningActivities: cont ?
      ["Presenting disjoint sets", "Illustrating the union of two sets",
        "Solving real-life set problems", "CLASS TEST administered"] :
      ["Illustrating the intersection of two sets using real objects",
        "Identifying the intersection using ∩",
        "Drawing circle diagrams from the local market"],
    expectedStandard: cont ?
      "Set operations applied appropriately; CLASS TEST administered" :
      "Set operations applied in everyday life appropriately",
    methods: ["Discussion", "Demonstration", "Group work"],
    tlAids: ["Real objects", "Venn diagrams", "Mathematics textbooks"],
    references: "Grade 4 Maths Syllabus p.1",
    source: "syllabi_studio",
  });
  return {
    schemaVersion: "2.0",
    header: {
      school: "Kabulonga Primary", teacherName: "Mrs Banda",
      grade: "4", subject: "Mathematics", term: 1, numberOfWeeks: 5,
      year: "2026", periodsPerWeek: "6 periods per week",
      mediumOfInstruction: "English", curriculum: "cbc",
    },
    weeks: [
      contentWeek(1, false),
      contentWeek(2, true),
      {
        week: 3,
        topic: "REVISION",
        subtopic: "All Topics Covered",
        specificCompetences: ["Review all Term 1 topics"],
        learningActivities: ["Reviewing set operations", "Solving mixed exercises",
          "Peer teaching of difficult areas"],
        expectedStandard: "All Term 1 competences reviewed and reinforced",
        methods: ["Q & A", "Group work", "Problem solving"],
        tlAids: ["Revision worksheets", "Flash cards", "Mathematics textbooks"],
        references: "Grade 4 Maths Syllabus pp.1-4",
        source: "syllabi_studio",
      },
      {
        week: 4,
        topic: "REVISION",
        subtopic: "All Topics Covered",
        specificCompetences: ["Consolidate Term 1 topics through practice"],
        learningActivities: ["Working past-paper questions", "Peer teaching",
          "Addressing areas of difficulty"],
        expectedStandard: "All Term 1 competences consolidated adequately",
        methods: ["Group work", "Problem solving", "Peer teaching"],
        tlAids: ["Past papers", "Revision worksheets", "Mathematics textbooks"],
        references: "Grade 4 Maths Syllabus pp.1-4",
        source: "syllabi_studio",
      },
      {
        week: 5,
        topic: "END OF TERM EXAM",
        subtopic: "All Topics",
        specificCompetences: ["Demonstrate mastery of all Term 1 competences"],
        learningActivities: ["Written examination covering all topics",
          "Individual problem-solving tasks", "Checking own work"],
        expectedStandard: "All Term 1 expected standards demonstrated in examination",
        methods: ["Written examination", "Individual assessment"],
        tlAids: ["Examination papers", "Mathematical instruments"],
        references: "Grade 4 Maths Syllabus pp.1-4",
        source: "syllabi_studio",
      },
    ],
  };
}

/** The same term as a lean OBC scheme (no activities / expected standard). */
function goodObcScheme() {
  const s = goodCbcScheme();
  s.header.curriculum = "obc";
  s.weeks = s.weeks.map((w) => ({
    ...w, learningActivities: [], expectedStandard: "",
  }));
  return s;
}

test("a clean CBC scheme passes every check", () => {
  const result = buildSchemeQualityChecks(goodCbcScheme());
  const failedChecks = result.checks.filter((c) => !c.ok).map((c) => c.code);
  assert.deepEqual(failedChecks, []);
  assert.equal(result.ok, true);
  assert.equal(result.failCount, 0);
  assert.equal(result.passCount, result.checks.length);
});

test("a clean OBC scheme passes and skips the CBC-only checks", () => {
  const result = buildSchemeQualityChecks(goodObcScheme());
  assert.equal(result.ok, true);
  assert.equal(result.checks.some((c) => c.code === "class_tests"), false);
  assert.equal(result.checks.some((c) => c.code === "activities_rich"), false);
});

test("flags a missing header field", () => {
  const s = goodCbcScheme();
  s.header.periodsPerWeek = "";
  const c = check(buildSchemeQualityChecks(s), "header_complete");
  assert.equal(c.ok, false);
  assert.match(c.detail, /periods per week/);
});

test("flags a gap in the week numbering", () => {
  const s = goodCbcScheme();
  s.weeks[2].week = 7;
  const c = check(buildSchemeQualityChecks(s), "weeks_numbered");
  assert.equal(c.ok, false);
});

test("flags a week count that misses the term plan", () => {
  const s = goodCbcScheme();
  s.header.numberOfWeeks = 12;
  const c = check(buildSchemeQualityChecks(s), "weeks_match_term");
  assert.equal(c.ok, false);
  assert.match(c.detail, /5 weeks .* expects 12/);
});

test("flags empty cells with the week and column named", () => {
  const s = goodCbcScheme();
  s.weeks[1].methods = [];
  s.weeks[1].subtopic = "";
  const c = check(buildSchemeQualityChecks(s), "cells_filled");
  assert.equal(c.ok, false);
  assert.match(c.detail, /Week 2: subtopic, methods/);
});

test("OBC ignores empty activities/expected-standard cells", () => {
  const result = buildSchemeQualityChecks(goodObcScheme());
  assert.equal(check(result, "cells_filled").ok, true);
});

test("flags a scheme with no class test (CBC)", () => {
  const s = goodCbcScheme();
  s.weeks[1].learningActivities = ["Presenting disjoint sets",
    "Illustrating the union of two sets", "Solving real-life set problems"];
  s.weeks[1].expectedStandard = "Set operations applied appropriately";
  const c = check(buildSchemeQualityChecks(s), "class_tests");
  assert.equal(c.ok, false);
});

test("flags a missing revision week", () => {
  const s = goodCbcScheme();
  s.weeks = [s.weeks[0], s.weeks[1], s.weeks[4]].map((w, i) => ({...w, week: i + 1}));
  s.header.numberOfWeeks = 3;
  const c = check(buildSchemeQualityChecks(s), "revision_present");
  assert.equal(c.ok, false);
});

test("flags a final week that is not the exam", () => {
  const s = goodCbcScheme();
  s.weeks[4].topic = "4.2 NUMBERS";
  const c = check(buildSchemeQualityChecks(s), "exam_week_last");
  assert.equal(c.ok, false);
});

test("flags thin activities on a teaching week only", () => {
  const s = goodCbcScheme();
  s.weeks[0].learningActivities = ["Illustrating sets", "Identifying sets"];
  const c = check(buildSchemeQualityChecks(s), "activities_rich");
  assert.equal(c.ok, false);
  assert.match(c.detail, /Week 1/);
  // Revision/exam weeks are exempt: trimming the exam week's list changes nothing.
  const s2 = goodCbcScheme();
  s2.weeks[4].learningActivities = ["Written examination"];
  assert.equal(check(buildSchemeQualityChecks(s2), "activities_rich").ok, true);
});

test("flags filler text and names the week", () => {
  const s = goodCbcScheme();
  s.weeks[3].references = "N/A";
  const c = check(buildSchemeQualityChecks(s), "no_filler");
  assert.equal(c.ok, false);
  assert.match(c.detail, /Week 4/);
});

test("survives a garbage payload without throwing", () => {
  const result = buildSchemeQualityChecks(null);
  assert.equal(result.ok, false);
  assert.ok(result.checks.length > 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
