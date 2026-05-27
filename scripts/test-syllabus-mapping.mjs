#!/usr/bin/env node
/**
 * Syllabus mapping unit tests.
 *
 * Covers the two mapping/loader modules that bridge between the Syllabi
 * Studio data shape (subject → sheet → rows of TOPIC/SUB-TOPIC/...) and
 * the CBC KB topic shape (grade+subject+topic with enriched sub-topics):
 *
 *   - src/utils/syllabusMapping.js          — client-side, pure ESM
 *   - functions/teacherTools/syllabiCurriculumData.js — server-side, CJS
 *
 * Failure modes this catches:
 *   - Sheet-name → grade regression (e.g. "Form 1" stops mapping to G8)
 *   - Studio-subject → CBC-subject drift (e.g. a syllabus rename
 *     orphans every entry under that subject)
 *   - rowsWithPropagatedTopic stops forwarding the topic across blank
 *     continuation rows (this would silently lose the topic-level
 *     grouping the AI prompt depends on)
 *   - Enriched sub-topic objects lose their per-subtopic data
 *
 * Run: npm run test:syllabus-mapping (also via npm run test:all).
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Module from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Stub firebase-admin so the server-side loader's loadOverrides() can
// be exercised with version=null (which skips Firestore entirely). The
// stub is only there to satisfy the require() at module-init time.
const adminStub = {
  firestore: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => ({docs: []}),
        }),
      }),
    }),
  }),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "firebase-admin") return "__stub__firebase-admin__";
  return origResolve.call(this, request, ...rest);
};
require.cache["__stub__firebase-admin__"] = {
  id: "__stub__firebase-admin__",
  filename: "__stub__firebase-admin__",
  loaded: true,
  exports: adminStub,
};

const {
  sheetNameToGrade: serverSheetToGrade,
  STUDIO_SUBJECT_TO_KB: SERVER_MAP,
  resolveKbSubject: serverResolveKbSubject,
  rowKey: serverRowKey,
  getCurriculumDataTopics,
  getMergedStudioData,
  loadRawData,
} = require(join(ROOT, "functions/teacherTools/syllabiCurriculumData.js"));

const {
  sheetNameToGrade: clientSheetToGrade,
  STUDIO_SUBJECT_TO_KB: CLIENT_MAP,
  rowKey: clientRowKey,
  rowsWithPropagatedTopic,
  syllabiToKbTopics,
  studioSubjectToKbSubject,
} = await import(join(ROOT, "src/utils/syllabusMapping.js"));

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  fail  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}
function eq(actual, expected, label = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}
function ok(cond, label = "condition") {
  if (!cond) throw new Error(`${label} was falsy`);
}

console.log("\nsheetNameToGrade");

test("ECE age-bands map to ECE", () => {
  eq(clientSheetToGrade("3-4 Years - English Language"), "ECE");
  eq(clientSheetToGrade("4-5 Years - Pre-Maths & Science"), "ECE");
});

test("Grade N sheets map to G<N>", () => {
  eq(clientSheetToGrade("Grade 4"), "G4");
  eq(clientSheetToGrade("Grade 6"), "G6");
  eq(clientSheetToGrade("Grade 1 - English Language"), "G1");
});

test("Form 1..4 map to G8..G11", () => {
  eq(clientSheetToGrade("Form 1"), "G8");
  eq(clientSheetToGrade("Form 2"), "G9");
  eq(clientSheetToGrade("Form 3"), "G10");
  eq(clientSheetToGrade("Form 4"), "G11");
});

test("'Form 3 - 4' bucket maps to G10", () => {
  eq(clientSheetToGrade("Form 3 - 4"), "G10");
});

test("Empty / unknown sheet names map to empty string", () => {
  eq(clientSheetToGrade(""), "");
  eq(clientSheetToGrade("Random Header"), "");
  eq(clientSheetToGrade(null), "");
});

test("Client + server sheet-mapping agree", () => {
  const cases = [
    "Grade 4", "Grade 5", "Grade 6",
    "Form 1", "Form 2", "Form 3", "Form 4",
    "3-4 Years - English Language",
    "Random Header",
  ];
  for (const c of cases) {
    if (clientSheetToGrade(c) !== serverSheetToGrade(c)) {
      throw new Error(`drift on "${c}": client=${clientSheetToGrade(c)} server=${serverSheetToGrade(c)}`);
    }
  }
});

console.log("\nSTUDIO_SUBJECT_TO_KB");

test("Client + server subject map have identical keys + values", () => {
  const clientKeys = Object.keys(CLIENT_MAP).sort();
  const serverKeys = Object.keys(SERVER_MAP).sort();
  eq(clientKeys, serverKeys, "key sets");
  for (const k of clientKeys) {
    if (CLIENT_MAP[k] !== SERVER_MAP[k]) {
      throw new Error(`value drift on "${k}": client=${CLIENT_MAP[k]} server=${SERVER_MAP[k]}`);
    }
  }
});

test("Map covers all 20 syllabi", () => {
  ok(Object.keys(CLIENT_MAP).length >= 20, "expected at least 20 syllabi mapped");
});

test("studioSubjectToKbSubject returns the canonical key", () => {
  eq(studioSubjectToKbSubject("Mathematics Syllabus (Forms 1-4)"), "mathematics");
  eq(studioSubjectToKbSubject("Physics Syllabus (Forms 1-4)"), "physics");
  eq(studioSubjectToKbSubject("Made-up subject"), "");
});

console.log("\nresolveKbSubject (sheet-aware for ECE + Lower Primary)");

test("ECE sheets dispatch by strand in the sheet name", () => {
  const ece = "Early Childhood Education Syllabi (3-5 Years)";
  eq(studioSubjectToKbSubject(ece, "3-4 Years - English Language"), "english");
  eq(studioSubjectToKbSubject(ece, "4-5 Years - English Language"), "english");
  eq(studioSubjectToKbSubject(ece, "3-4 Years - Zambian Languages"), "zambian_language");
  eq(studioSubjectToKbSubject(ece, "3-4 Years - Pre-Maths & Science"), "numeracy");
  eq(studioSubjectToKbSubject(ece, "3-4 Years - Creative & Tech"), "expressive_arts");
});

test("Lower Primary sheets dispatch by strand in the sheet name", () => {
  const lp = "Lower Primary Syllabi (Grades 1-3)";
  eq(studioSubjectToKbSubject(lp, "Grade 1 - English Language"), "english");
  eq(studioSubjectToKbSubject(lp, "Grade 2 - Zambian Languages"), "zambian_language");
  eq(studioSubjectToKbSubject(lp, "Grade 3 - Maths & Science"), "numeracy");
  eq(studioSubjectToKbSubject(lp, "Grade 1 - Creative & Technology"), "creative_and_technology_studies");
});

test("Single-subject syllabi ignore sheet name (return canonical key)", () => {
  eq(studioSubjectToKbSubject("Mathematics Syllabus (Forms 1-4)", "Form 1"), "mathematics");
  eq(studioSubjectToKbSubject("Mathematics Syllabus (Forms 1-4)"), "mathematics");
});

test("Client + server resolveKbSubject agree on ECE + LP sheets", () => {
  const cases = [
    ["Early Childhood Education Syllabi (3-5 Years)", "3-4 Years - English Language"],
    ["Early Childhood Education Syllabi (3-5 Years)", "3-4 Years - Zambian Languages"],
    ["Early Childhood Education Syllabi (3-5 Years)", "3-4 Years - Pre-Maths & Science"],
    ["Early Childhood Education Syllabi (3-5 Years)", "3-4 Years - Creative & Tech"],
    ["Lower Primary Syllabi (Grades 1-3)", "Grade 1 - English Language"],
    ["Lower Primary Syllabi (Grades 1-3)", "Grade 1 - Zambian Languages"],
    ["Lower Primary Syllabi (Grades 1-3)", "Grade 1 - Maths & Science"],
    ["Lower Primary Syllabi (Grades 1-3)", "Grade 1 - Creative & Technology"],
    ["Mathematics Syllabus (Forms 1-4)", "Form 1"],
  ];
  for (const [subj, sheet] of cases) {
    const c = studioSubjectToKbSubject(subj, sheet);
    const s = serverResolveKbSubject(subj, sheet);
    if (c !== s) {
      throw new Error(`drift on (${subj}, ${sheet}): client=${c} server=${s}`);
    }
  }
});

console.log("\nrowsWithPropagatedTopic");

test("Blank-topic rows inherit the previous row's topic", () => {
  const out = rowsWithPropagatedTopic([
    {type: "section", label: "STRAND ONE"},
    {type: "data", cells: {TOPIC: "1.1 Numbers", "SUB-TOPIC": "Counting"}},
    {type: "data", cells: {TOPIC: "", "SUB-TOPIC": "Place Value"}},
    {type: "data", cells: {TOPIC: "1.2 Operations", "SUB-TOPIC": "Addition"}},
  ]);
  eq(out.length, 3);
  eq(out[0].topic, "1.1 Numbers");
  eq(out[1].topic, "1.1 Numbers"); // propagated
  eq(out[2].topic, "1.2 Operations");
  eq(out[0].section, "STRAND ONE");
});

test("Section rows are not emitted as data rows", () => {
  const out = rowsWithPropagatedTopic([
    {type: "section", label: "BANNER"},
    {type: "data", cells: {TOPIC: "X", "SUB-TOPIC": "Y"}},
  ]);
  eq(out.length, 1);
});

console.log("\nsyllabiToKbTopics");

test("Collapses rows under the same topic into one entry", () => {
  const fixture = {
    "Mathematics Syllabus (Forms 1-4)": {
      "Form 1": {
        title: "x",
        columns: ["TOPIC", "SUB-TOPIC", "SPECIFIC COMPETENCES", "LEARNING ACTIVITIES", "EXPECTED STANDARD"],
        rows: [
          {type: "data", cells: {
            TOPIC: "Sets",
            "SUB-TOPIC": "Union",
            "SPECIFIC COMPETENCES": "Apply union",
            "LEARNING ACTIVITIES": "Find A ∪ B",
            "EXPECTED STANDARD": "Union performed",
          }},
          {type: "data", cells: {
            TOPIC: "",
            "SUB-TOPIC": "Intersection",
            "SPECIFIC COMPETENCES": "Apply intersection",
            "LEARNING ACTIVITIES": "Find A ∩ B",
            "EXPECTED STANDARD": "Intersection performed",
          }},
          {type: "data", cells: {
            TOPIC: "Algebra",
            "SUB-TOPIC": "Linear",
            "SPECIFIC COMPETENCES": "Solve linear",
            "LEARNING ACTIVITIES": "Solve 2x+1=5",
            "EXPECTED STANDARD": "Linear solved",
          }},
        ],
      },
    },
  };
  const topics = syllabiToKbTopics(fixture);
  eq(topics.length, 2, "one entry per (grade, subject, topic)");
  const sets = topics.find((t) => t.topic === "Sets");
  ok(sets, "Sets topic exists");
  eq(sets.grade, "G8");
  eq(sets.subject, "mathematics");
  eq(sets.subtopics.length, 2);
  eq(sets.subtopics[0].name, "Union");
  eq(sets.subtopics[0].specificCompetence, "Apply union");
  eq(sets.subtopics[0].learningActivities, "Find A ∪ B");
  eq(sets.subtopics[0].expectedStandard, "Union performed");
  // Bubble-up: specificCompetences become topic-level outcomes too.
  eq(sets.specificOutcomes.length, 2);
});

test("Unknown studio subject is dropped (no orphan topics)", () => {
  const fixture = {
    "Subject Nobody Mapped": {
      "Form 1": {
        rows: [
          {type: "data", cells: {TOPIC: "X", "SUB-TOPIC": "Y"}},
        ],
      },
    },
  };
  eq(syllabiToKbTopics(fixture).length, 0);
});

console.log("\nrowKey");

test("rowKey is deterministic and case-insensitive", () => {
  const a = clientRowKey("Mathematics Syllabus (Forms 1-4)", "Form 1", "Sets", "Union");
  const b = serverRowKey("MATHEMATICS SYLLABUS (FORMS 1-4)", "form 1", " Sets ", "union");
  eq(a, b, "client/server case-insensitive parity");
});

console.log("\nServer loader against the real data file");

test("Raw data file loads with 20 syllabi", () => {
  const raw = loadRawData();
  ok(Object.keys(raw).length >= 20, "expected at least 20 syllabi in JSON");
});

test("getCurriculumDataTopics returns at least 500 entries", async () => {
  const topics = await getCurriculumDataTopics(null);
  ok(topics.length >= 500, `expected >=500 topics, got ${topics.length}`);
});

test("Every produced topic carries grade + subject + topic", async () => {
  const topics = await getCurriculumDataTopics(null);
  for (const t of topics) {
    if (!t.grade || !t.subject || !t.topic) {
      throw new Error(`bad topic: ${JSON.stringify(t).slice(0, 200)}`);
    }
  }
});

test("getMergedStudioData passes data through when version=null", async () => {
  const merged = await getMergedStudioData(null);
  ok(Object.keys(merged).length >= 20, "merged shape preserved");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
