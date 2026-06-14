/**
 * Unit tests for scheme-of-work advisories (pure rules).
 * Plain node: `node functions/teacherTools/schemeAdvisories.test.js`
 */

const assert = require("node:assert/strict");
const {buildSchemeAdvisories} = require("./schemeAdvisories");

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

function codes(advisories) {
  return advisories.map((a) => a.code);
}

const baseOutline = {topicCount: 8, subtopicCount: 16};

test("no advisories when everything lines up", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "mathematics", subjectLabel: "Mathematics",
    numberOfWeeks: 12,
    classification: "in_syllabus",
    outline: baseOutline,
    timetableSummary: {found: true, periods: 6, days: ["Monday"]},
  });
  assert.deepEqual(adv, []);
});

test("flags a subject not in the grade's syllabus", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "biology", subjectLabel: "Biology",
    numberOfWeeks: 12,
    classification: "not_in_grade",
    officialSubjects: ["english", "mathematics"],
    outline: baseOutline,
    timetableSummary: null,
  });
  assert.ok(codes(adv).includes("subject_not_in_grade"));
  assert.match(adv[0].message, /english, mathematics/);
});

test("flags too few periods vs the curriculum allocation", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "mathematics", subjectLabel: "Mathematics",
    numberOfWeeks: 12,
    classification: "in_syllabus",
    outline: baseOutline,
    timetableSummary: {found: true, periods: 3, days: ["Monday", "Friday"]},
  });
  const tooFew = adv.find((a) => a.code === "too_few_periods");
  assert.ok(tooFew);
  assert.equal(tooFew.level, "warning");
  assert.match(tooFew.message, /Monday, Friday/);
});

test("notes too many periods as an info-level opportunity", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "home_economics", subjectLabel: "Home Economics",
    numberOfWeeks: 12,
    classification: "in_syllabus",
    outline: baseOutline,
    timetableSummary: {found: true, periods: 6, days: []}, // rec is 3
  });
  const many = adv.find((a) => a.code === "too_many_periods");
  assert.ok(many);
  assert.equal(many.level, "info");
});

test("flags a subject missing from the attached timetable", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "mathematics", subjectLabel: "Mathematics",
    numberOfWeeks: 12,
    classification: "in_syllabus",
    outline: baseOutline,
    timetableSummary: {found: false, periods: 0, days: []},
  });
  assert.ok(codes(adv).includes("subject_missing_timetable"));
});

test("flags more topics than weeks", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "mathematics", subjectLabel: "Mathematics",
    numberOfWeeks: 6,
    classification: "in_syllabus",
    outline: {topicCount: 10, subtopicCount: 20},
    timetableSummary: {found: true, periods: 6, days: []},
  });
  assert.ok(codes(adv).includes("too_many_topics"));
});

test("flags a heavy scheme vs available periods", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "mathematics", subjectLabel: "Mathematics",
    numberOfWeeks: 10,
    classification: "in_syllabus",
    outline: {topicCount: 8, subtopicCount: 40}, // 40 subtopics
    timetableSummary: {found: true, periods: 3, days: []}, // 30 periods
  });
  assert.ok(codes(adv).includes("scheme_heavy"));
});

test("notes missing curriculum data when the outline is empty", () => {
  const adv = buildSchemeAdvisories({
    grade: "G4", subject: "mathematics", subjectLabel: "Mathematics",
    numberOfWeeks: 12,
    classification: "in_syllabus",
    outline: {topicCount: 0, subtopicCount: 0},
    timetableSummary: null,
  });
  const note = adv.find((a) => a.code === "no_curriculum_data");
  assert.ok(note);
  assert.equal(note.level, "info");
});

console.log(`\n─── ${passed + failed} tests · ${passed} passed · ${failed} failed ───`);
if (failed > 0) process.exit(1);
