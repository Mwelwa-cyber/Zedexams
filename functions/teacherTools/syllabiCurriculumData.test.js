/**
 * Unit tests for the syllabus curriculum-data access layer.
 * Plain Node assertions, no test runner (repo convention). Reads only the
 * committed syllabus JSON (no Firebase, no network) — loadOverrides is
 * exercised on its error path only, which is what a root-only install hits.
 *
 *   node functions/teacherTools/syllabiCurriculumData.test.js
 */

const assert = require("node:assert");
const {
  STUDIO_SUBJECT_TO_KB,
  VALID_FRAMEWORKS,
  DEFAULT_FRAMEWORK,
  normalizeFramework,
  sheetNameToGrade,
  resolveKbSubject,
  rowKey,
  loadRawData,
  loadOverrides,
  applyOverridesToRaw,
  getCurriculumDataTopics,
  get2013CurriculumDataTopics,
  getMergedStudioData,
  invalidateCache,
  _dataCachePath,
} = require("./syllabiCurriculumData");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

async function run() {
  // ── framework normalisation ──────────────────────────────────────
  await test("normalizeFramework accepts both frameworks and defaults the rest", () => {
    assert.strictEqual(normalizeFramework("2013"), "2013");
    assert.strictEqual(normalizeFramework("2023"), "2023");
    assert.strictEqual(normalizeFramework(" 2013 "), "2013");
    assert.strictEqual(normalizeFramework("cbc"), DEFAULT_FRAMEWORK);
    assert.strictEqual(normalizeFramework(null), DEFAULT_FRAMEWORK);
    assert.ok(VALID_FRAMEWORKS.includes(DEFAULT_FRAMEWORK));
  });

  // ── sheet-name → grade code ──────────────────────────────────────
  await test("sheetNameToGrade maps grades, forms and ECE bands", () => {
    assert.strictEqual(sheetNameToGrade("Grade 4"), "G4");
    assert.strictEqual(sheetNameToGrade("grade10"), "G10");
    assert.strictEqual(sheetNameToGrade("Form 1"), "G8");
    assert.strictEqual(sheetNameToGrade("Form 5"), "G12");
    assert.strictEqual(sheetNameToGrade("Nursery (3-4 years)"), "ECE_N");
    assert.strictEqual(sheetNameToGrade("Reception 4-5 years"), "ECE_R");
    assert.strictEqual(sheetNameToGrade("ECE 3-5 years"), "ECE");
    assert.strictEqual(sheetNameToGrade("Notes"), "");
    assert.strictEqual(sheetNameToGrade(""), "");
  });

  // ── studio subject → KB subject ──────────────────────────────────
  await test("resolveKbSubject uses the sheet to split bundled ECE/Lower-Primary strands", () => {
    const ece = "Early Childhood Education Syllabi (3-5 Years)";
    assert.strictEqual(resolveKbSubject(ece, "English Language"), "english");
    assert.strictEqual(resolveKbSubject(ece, "Zambian Languages"), "zambian_language");
    assert.strictEqual(resolveKbSubject(ece, "Creative Arts"), "expressive_arts");
    assert.strictEqual(resolveKbSubject(ece, "Mathematics"), "numeracy");
    const lp = "Lower Primary Syllabi (Grades 1-3)";
    assert.strictEqual(resolveKbSubject(lp, "Creative and Tech Studies"),
        "creative_and_technology_studies");
    assert.strictEqual(resolveKbSubject(lp, "Numeracy"), "numeracy");
  });

  await test("resolveKbSubject falls back to the top-level map for single-subject syllabi", () => {
    const [subject, kb] = Object.entries(STUDIO_SUBJECT_TO_KB)
        .find(([s]) => !s.startsWith("Early") && !s.startsWith("Lower"));
    assert.strictEqual(resolveKbSubject(subject, "Grade 8"), kb);
    assert.strictEqual(resolveKbSubject("Unknown Subject", "Grade 8"), "");
  });

  // ── row identity ─────────────────────────────────────────────────
  await test("rowKey lower-cases, trims and underscores each part", () => {
    assert.strictEqual(
        rowKey("Maths", "Grade 4", " Number Line ", ""),
        "maths||grade_4||number_line||",
    );
  });

  // ── raw data loading (committed JSON, cache, invalidation) ───────
  await test("loadRawData reads the committed syllabus JSON and caches it", () => {
    invalidateCache();
    const first = loadRawData(DEFAULT_FRAMEWORK);
    assert.ok(first && typeof first === "object");
    assert.ok(Object.keys(first).length > 0, "expected committed 2023 syllabus data");
    assert.strictEqual(loadRawData(DEFAULT_FRAMEWORK), first, "second read must hit the cache");
    assert.ok(String(_dataCachePath(DEFAULT_FRAMEWORK) || "").endsWith(".json"));
    const previous = loadRawData("2013");
    assert.ok(previous && typeof previous === "object");
  });

  // ── override application ─────────────────────────────────────────
  const rawFixture = () => ({
    Maths: {
      "Grade 4": {
        title: "Grade 4",
        columns: ["TOPIC", "SUB-TOPIC"],
        rows: [
          {type: "data", cells: {"TOPIC": "Sets", "SUB-TOPIC": "Members"}},
          {type: "data", cells: {"TOPIC": "", "SUB-TOPIC": "Symbols"}},
        ],
      },
    },
  });

  await test("applyOverridesToRaw returns the input untouched with no overrides", () => {
    const raw = rawFixture();
    assert.strictEqual(applyOverridesToRaw(raw, []), raw);
    assert.strictEqual(applyOverridesToRaw(raw, null), raw);
  });

  await test("an edit override matches by propagated topic + subtopic", () => {
    const out = applyOverridesToRaw(rawFixture(), [{
      studioSubject: "Maths", sheet: "Grade 4",
      topic: "Sets", subtopic: "Symbols",
      cells: {"SUB-TOPIC": "Set symbols"},
    }]);
    // Row 2 has a blank TOPIC cell; the override still finds it via the
    // forward-propagated "Sets".
    assert.strictEqual(out.Maths["Grade 4"].rows[1].cells["SUB-TOPIC"], "Set symbols");
  });

  await test("a deleted override tombstones the row; inserted appends", () => {
    const out = applyOverridesToRaw(rawFixture(), [
      {studioSubject: "Maths", sheet: "Grade 4", topic: "Sets", subtopic: "Members", deleted: true},
      {studioSubject: "Maths", sheet: "Grade 4", inserted: true, cells: {"TOPIC": "Fractions"}},
    ]);
    const rows = out.Maths["Grade 4"].rows;
    assert.strictEqual(rows.length, 2);
    assert.ok(!rows.some((r) => r.cells["SUB-TOPIC"] === "Members"));
    assert.strictEqual(rows[1].cells.TOPIC, "Fractions");
  });

  await test("an unmatched edit with cells appends as a new row; a new sheet is scaffolded", () => {
    const out = applyOverridesToRaw(rawFixture(), [{
      studioSubject: "Science", sheet: "Grade 5",
      topic: "Plants", subtopic: "Roots", cells: {"TOPIC": "Plants"},
    }]);
    assert.ok(Array.isArray(out.Science["Grade 5"].rows));
    assert.strictEqual(out.Science["Grade 5"].rows.length, 1);
  });

  // ── derived topic lookups over the committed data ────────────────
  await test("getCurriculumDataTopics yields per-grade topic entries", async () => {
    const topics = await getCurriculumDataTopics();
    assert.ok(topics && typeof topics === "object");
    const keys = Object.keys(topics);
    assert.ok(keys.length > 0, "expected topics derived from committed data");
  });

  await test("get2013CurriculumDataTopics reads the previous framework's file", async () => {
    const topics = await get2013CurriculumDataTopics();
    assert.ok(topics && typeof topics === "object");
  });

  await test("getMergedStudioData without a version skips overrides entirely", async () => {
    const merged = await getMergedStudioData(null);
    assert.ok(merged && typeof merged === "object");
    assert.ok(Object.keys(merged).length > 0);
  });

  // ── loadOverrides fails soft without Firestore ───────────────────
  await test("loadOverrides degrades to [] when Firestore is unavailable", async () => {
    const out = await loadOverrides("v-any");
    assert.deepStrictEqual(out, []);
  });

  invalidateCache();
  console.log(`\nsyllabiCurriculumData: all ${passed} tests passed`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
