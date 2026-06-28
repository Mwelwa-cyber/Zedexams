/**
 * Unit tests for the Template Bank pure helpers (lessonPlanTemplateBank.js).
 * Plain `node` assertions — run with `npm run test:template-bank`.
 */

const assert = require("assert");
const {
  anonymizeLessonPlan,
  extractTemplateCoords,
  templateDedupeKey,
  extractKeywords,
  scoreTemplateDeterministic,
  meetsQualityFloor,
  mergeTemplateContent,
  shouldMerge,
  buildTemplateRecord,
  normalizeGrade,
} = require("./lessonPlanTemplateBank");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const richPlan = {
  header: {
    school: "Twalumba Primary",
    teacherName: "Mr Banda",
    date: "2026-06-28",
    time: "08:00",
    class: "5B",
    lessonNumber: 3,
    boysPresent: 18,
    girlsPresent: 20,
    totalPupils: 38,
    numberOfPupils: 38,
    subject: "Mathematics",
    topic: "4.5 Fractions",
    subtopic: "4.5.1 Equivalent fractions",
    grade: "Grade 5",
    durationMinutes: 40,
    mediumOfInstruction: "English",
    termAndWeek: "Term 2 Week 4",
  },
  generalCompetences: ["Critical thinking", "Communication"],
  specificCompetence: "4.5.1 Identify equivalent fractions",
  specificOutcome: "Learners identify equivalent fractions",
  lessonGoal: "By the end of the lesson, learners will identify and generate equivalent fractions using diagrams.",
  rationale: "Equivalent fractions underpin later work on operations with fractions.",
  expectedStandard: "Equivalent fractions are identified and generated correctly.",
  materials: ["Fraction wall", "Chalkboard", "Counters"],
  keyVocabulary: ["numerator", "denominator", "equivalent"],
  references: ["CBC Maths Grade 5 syllabus p.21"],
  stages: [
    {name: "INTRODUCTION", duration: "5", teacher: "Review halves and quarters", pupils: "Recall prior fractions", assessment: "Oral check"},
    {name: "LESSON DEVELOPMENT", duration: "20", teacher: "Demonstrate equivalent fractions on the fraction wall", pupils: "Build equivalent fractions in pairs", assessment: "Observe pair work"},
    {name: "EXERCISE / ASSESSMENT", duration: "10", teacher: "Set written exercise", pupils: "Complete exercise", assessment: "Mark exercise"},
  ],
  remedialWork: "Extra fraction-wall practice for strugglers.",
  extensionActivity: "Generate three equivalents for a given fraction.",
  coveredContent: ["equivalent fractions", "fraction wall"],
};

test("anonymizeLessonPlan strips all personal header fields", () => {
  const clean = anonymizeLessonPlan(richPlan);
  for (const k of ["school", "teacherName", "date", "time", "class", "lessonNumber",
    "boysPresent", "girlsPresent", "totalPupils", "numberOfPupils"]) {
    assert.ok(!(k in clean.header), `header.${k} should be stripped`);
  }
  // Curriculum/pedagogy content is preserved.
  assert.strictEqual(clean.header.subject, "Mathematics");
  assert.strictEqual(clean.header.topic, "4.5 Fractions");
  assert.strictEqual(clean.lessonGoal, richPlan.lessonGoal);
  assert.strictEqual(clean.stages.length, 3);
});

test("anonymizeLessonPlan does not mutate the source plan", () => {
  const before = JSON.stringify(richPlan);
  anonymizeLessonPlan(richPlan);
  assert.strictEqual(JSON.stringify(richPlan), before);
});

test("anonymizeLessonPlan drops unknown (fail-closed) header keys", () => {
  const clean = anonymizeLessonPlan({header: {subject: "X", secretTeacherNote: "call me"}});
  assert.ok(!("secretTeacherNote" in clean.header));
  assert.strictEqual(clean.header.subject, "X");
});

test("normalizeGrade canonicalises grade labels", () => {
  assert.strictEqual(normalizeGrade("G5"), "Grade 5");
  assert.strictEqual(normalizeGrade("grade 7"), "Grade 7");
  assert.strictEqual(normalizeGrade("Form 1"), "Form 1");
});

test("extractTemplateCoords strips CBC codes from topic/subtopic/competency", () => {
  const c = extractTemplateCoords(richPlan, {}, {});
  assert.strictEqual(c.topic, "Fractions");
  assert.strictEqual(c.subtopic, "Equivalent fractions");
  assert.strictEqual(c.competency, "Identify equivalent fractions");
  assert.strictEqual(c.grade, "Grade 5");
  assert.strictEqual(c.subject, "Mathematics");
});

test("templateDedupeKey is stable across code/spacing/case differences", () => {
  const a = templateDedupeKey(extractTemplateCoords(richPlan, {}, {}));
  const variant = JSON.parse(JSON.stringify(richPlan));
  variant.header.topic = "Fractions";
  variant.header.subtopic = "EQUIVALENT   Fractions";
  variant.header.grade = "G5";
  const b = templateDedupeKey(extractTemplateCoords(variant, {}, {}));
  assert.strictEqual(a, b, "same lesson should dedupe to one key");
});

test("extractKeywords returns lowercase content tokens without stopwords", () => {
  const coords = extractTemplateCoords(richPlan, {}, {});
  const kw = extractKeywords(anonymizeLessonPlan(richPlan), coords);
  assert.ok(kw.includes("fractions"));
  assert.ok(kw.includes("equivalent"));
  assert.ok(!kw.includes("the"));
});

test("scoreTemplateDeterministic returns bounded 0-100 score + 8 axes", () => {
  const {score, breakdown} = scoreTemplateDeterministic(anonymizeLessonPlan(richPlan));
  assert.ok(score >= 0 && score <= 100);
  assert.ok(score >= 60, `rich plan should score well, got ${score}`);
  const axes = ["curriculumAlignment", "completeness", "accuracy", "methodology",
    "engagement", "assessment", "clarity", "resources"];
  for (const a of axes) {
    assert.ok(breakdown[a] >= 0 && breakdown[a] <= 100, `${a} out of range`);
  }
});

test("meetsQualityFloor rejects a near-empty plan", () => {
  const thin = scoreTemplateDeterministic({header: {subject: "Maths"}});
  assert.ok(!meetsQualityFloor(thin), "thin plan should fail the floor");
  const rich = scoreTemplateDeterministic(anonymizeLessonPlan(richPlan));
  assert.ok(meetsQualityFloor(rich));
});

test("mergeTemplateContent grafts a missing section from the weaker plan", () => {
  const withRef = anonymizeLessonPlan(richPlan);
  const withoutRef = anonymizeLessonPlan({...richPlan, references: [], remedialWork: ""});
  // base = withoutRef (treat as higher score), other = withRef
  const merged = mergeTemplateContent(withoutRef, withRef, 80, 70);
  assert.ok(Array.isArray(merged.references) && merged.references.length > 0,
    "missing references should be filled from the other plan");
});

test("shouldMerge is true when incoming adds a section, false on like-for-like", () => {
  const full = anonymizeLessonPlan(richPlan);
  const missingRemedial = anonymizeLessonPlan({...richPlan, remedialWork: "", extensionActivity: ""});
  assert.strictEqual(shouldMerge(70, 70, missingRemedial, full), true);
  assert.strictEqual(shouldMerge(70, 70, full, full), false);
  assert.strictEqual(shouldMerge(70, 80, full, full), true);
});

test("buildTemplateRecord produces a search-ready record", () => {
  const rec = buildTemplateRecord({plan: richPlan, inputs: {}, meta: {}, curriculumVersion: "cbc-2026"});
  assert.strictEqual(rec.subject, "Mathematics");
  assert.strictEqual(rec.topic, "Fractions");
  assert.ok(rec.dedupeKey.includes("fractions"));
  assert.ok(rec.qualityScore >= 0 && rec.qualityScore <= 100);
  assert.ok(rec.preview.length > 0);
  assert.ok(!("school" in (rec.content.header || {})), "record content must be anonymised");
  assert.strictEqual(rec.curriculumVersion, "cbc-2026");
});

console.log(`\nlessonPlanTemplateBank: ${passed} tests passed.`);
