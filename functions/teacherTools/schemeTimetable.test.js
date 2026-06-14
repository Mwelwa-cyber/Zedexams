/**
 * Unit tests for scheme-of-work timetable awareness (pure helpers).
 * Plain node: `node functions/teacherTools/schemeTimetable.test.js`
 */

const assert = require("node:assert/strict");
const {
  recommendedPeriodsPerWeek,
  subjectMatches,
  sanitizeTimetableInput,
  summarizeTimetableForSubject,
} = require("./schemeTimetable");

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

test("recommendedPeriodsPerWeek weights core subjects heaviest", () => {
  assert.equal(recommendedPeriodsPerWeek("mathematics"), 6);
  assert.equal(recommendedPeriodsPerWeek("english"), 6);
  assert.equal(recommendedPeriodsPerWeek("integrated_science"), 5);
  assert.equal(recommendedPeriodsPerWeek("social_studies"), 4);
  assert.equal(recommendedPeriodsPerWeek("home_economics"), 3);
});

test("subjectMatches handles slug + label variants", () => {
  assert.equal(subjectMatches("Mathematics", "mathematics"), true);
  assert.equal(subjectMatches("Integrated Science", "integrated_science"), true);
  assert.equal(subjectMatches("Science", "integrated_science"), true);
  assert.equal(subjectMatches("Social Studies", "social_studies"), true);
  assert.equal(subjectMatches("English", "mathematics"), false);
  assert.equal(subjectMatches("", "mathematics"), false);
});

test("sanitizeTimetableInput keeps trusted fields, drops junk", () => {
  const clean = sanitizeTimetableInput({
    header: {grade: "G4", className: "4 Blue", term: 2},
    days: ["Monday", "Wednesday", "Friday", 7, ""],
    subjects: [
      {label: "Mathematics", periodsPerWeek: "6"},
      {label: "", periodsPerWeek: 3},
    ],
    slots: {
      p1: {Monday: "Mathematics", Wednesday: {subjectLabel: "Mathematics"}},
      bad: "not-an-object",
    },
  });
  assert.equal(clean.header.grade, "G4");
  assert.equal(clean.header.term, "2");
  assert.deepEqual(clean.days, ["Monday", "Wednesday", "Friday"]);
  assert.equal(clean.subjects.length, 1);
  assert.equal(clean.subjects[0].periodsPerWeek, 6);
  assert.equal(clean.slots.p1.Monday, "Mathematics");
  assert.equal(clean.slots.p1.Wednesday, "Mathematics");
});

test("sanitizeTimetableInput returns null for unusable input", () => {
  assert.equal(sanitizeTimetableInput(null), null);
  assert.equal(sanitizeTimetableInput("nope"), null);
  assert.equal(sanitizeTimetableInput({days: ["Monday"]}), null);
});

test("summarizeTimetableForSubject counts placed cells + days", () => {
  const tt = sanitizeTimetableInput({
    days: ["Monday", "Tuesday", "Wednesday"],
    subjects: [{label: "Mathematics", periodsPerWeek: 6}],
    slots: {
      p1: {Monday: "Mathematics", Wednesday: "Mathematics"},
      p2: {Monday: "Mathematics", Tuesday: "English"},
    },
  });
  const sum = summarizeTimetableForSubject(tt, "mathematics");
  assert.equal(sum.found, true);
  assert.equal(sum.periods, 3);
  assert.deepEqual(sum.days, ["Monday", "Wednesday"]);
});

test("summarizeTimetableForSubject falls back to declared allocation", () => {
  const tt = sanitizeTimetableInput({
    subjects: [{label: "Mathematics", periodsPerWeek: 5}],
    slots: {p1: {Monday: "English"}},
  });
  const sum = summarizeTimetableForSubject(tt, "mathematics");
  assert.equal(sum.found, true);
  assert.equal(sum.periods, 5);
  assert.deepEqual(sum.days, []);
});

test("summarizeTimetableForSubject reports missing subject", () => {
  const tt = sanitizeTimetableInput({
    subjects: [{label: "English", periodsPerWeek: 6}],
    slots: {p1: {Monday: "English"}},
  });
  const sum = summarizeTimetableForSubject(tt, "mathematics");
  assert.equal(sum.found, false);
  assert.equal(sum.periods, 0);
});

test("summarizeTimetableForSubject handles a null timetable", () => {
  const sum = summarizeTimetableForSubject(null, "mathematics");
  assert.deepEqual(sum, {found: false, periods: 0, days: []});
});

console.log(`\n─── ${passed + failed} tests · ${passed} passed · ${failed} failed ───`);
if (failed > 0) process.exit(1);
