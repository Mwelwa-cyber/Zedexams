/**
 * Unit tests for the v2 scheme-of-work validator (official 9-column shape).
 * Plain node, repo convention: `node functions/teacherTools/schemeOfWorkSchema.test.js`
 */

const assert = require("node:assert/strict");
const {SCHEMA_VERSION, validateSchemeOfWork} = require("./schemeOfWorkSchema");

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

const goodWeek = {
  week: 1,
  topic: "4.1 THE HUMAN BODY",
  subtopic: "4.1.1 The Respiratory System",
  specificCompetences: ["4.1.1.1 Demonstrate understanding of the respiratory system"],
  learningActivities: ["Describing the respiratory system", "Drawing the human respiratory system"],
  expectedStandard: "Understanding of the respiratory system demonstrated satisfactorily",
  methods: ["Exposition", "Q & A", "Group work"],
  tlAids: ["Charts", "Models", "Science Module"],
  references: "Grade 4 Science Syllabus p.1",
};

const goodHeader = {
  school: "Kalulu Primary",
  teacherName: "Mrs Zulu",
  grade: "4",
  subject: "Integrated Science",
  term: 1,
  numberOfWeeks: 12,
  year: "2026",
  periodsPerWeek: "6 periods × 40 minutes",
  mediumOfInstruction: "English",
};

test("valid official-shape scheme passes and is normalised", () => {
  const res = validateSchemeOfWork({header: goodHeader, weeks: [goodWeek]});
  assert.equal(res.ok, true);
  assert.equal(res.value.schemaVersion, SCHEMA_VERSION);
  assert.equal(res.value.header.grade, "4");
  assert.equal(res.value.weeks[0].week, 1);
  assert.deepEqual(res.value.weeks[0].methods, ["Exposition", "Q & A", "Group work"]);
});

test("weekNumber and class fallbacks are accepted (older drafts)", () => {
  const res = validateSchemeOfWork({
    header: {...goodHeader, grade: undefined, class: "Grade 5"},
    weeks: [{...goodWeek, week: undefined, weekNumber: 3}],
  });
  assert.equal(res.ok, true);
  assert.equal(res.value.header.grade, "Grade 5");
  assert.equal(res.value.weeks[0].week, 3);
});

test("missing week numbers fall back to position", () => {
  const res = validateSchemeOfWork({
    header: goodHeader,
    weeks: [
      {...goodWeek, week: undefined},
      {...goodWeek, week: undefined, topic: "4.2 NUTRITION & HEALTH"},
    ],
  });
  assert.equal(res.value.weeks[0].week, 1);
  assert.equal(res.value.weeks[1].week, 2);
});

test("academicYear is accepted as year fallback", () => {
  const res = validateSchemeOfWork({
    header: {...goodHeader, year: undefined, academicYear: "2025"},
    weeks: [goodWeek],
  });
  assert.equal(res.value.header.year, "2025");
});

test("junk values are normalised, never crash", () => {
  const res = validateSchemeOfWork({
    header: goodHeader,
    weeks: [{
      week: "one",
      topic: "   ",
      subtopic: 7,
      specificCompetences: "not-an-array",
      learningActivities: [null, "  Real activity  ", ""],
      expectedStandard: null,
      methods: [42],
      tlAids: undefined,
      references: false,
    }],
  });
  assert.equal(res.ok, true);
  const w = res.value.weeks[0];
  assert.equal(w.week, 1);
  assert.equal(w.topic, "Week 1");
  assert.equal(w.subtopic, "");
  assert.deepEqual(w.specificCompetences, []);
  assert.deepEqual(w.learningActivities, ["Real activity"]);
  assert.deepEqual(w.methods, []);
  assert.deepEqual(w.tlAids, []);
  assert.equal(w.references, "");
});

test("empty weeks fails validation", () => {
  const res = validateSchemeOfWork({header: goodHeader, weeks: []});
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /no weeks/i.test(e)));
});

test("missing grade and subject are reported", () => {
  const res = validateSchemeOfWork({header: {}, weeks: [goodWeek]});
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /grade/.test(e)));
  assert.ok(res.errors.some((e) => /subject/.test(e)));
});

console.log(`\n─── ${passed + failed} tests · ${passed} passed · ${failed} failed ───`);
if (failed > 0) process.exit(1);
