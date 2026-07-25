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
import { fileURLToPath, pathToFileURL } from "node:url";
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
  // On Windows, ESM dynamic-import refuses bare absolute paths ("M:\..."); the
  // file:// URL form works on both Windows and POSIX. (require() above is fine
  // with OS paths — only import() needs the URL.)
} = await import(pathToFileURL(join(ROOT, "src/utils/syllabusMapping.js")).href);

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

test("ECE age-bands map to their own grade codes", () => {
  // Nursery (3-4) → ECE_N, Reception (4-5) → ECE_R so the topic/sub-topic
  // pickers can scope to the band the teacher selected.
  eq(clientSheetToGrade("3-4 Years - English Language"), "ECE_N");
  eq(clientSheetToGrade("4-5 Years - Pre-Maths & Science"), "ECE_R");
  // The combined band (if a sheet ever uses it) stays the generic 'ECE'.
  eq(clientSheetToGrade("3-5 Years - English Language"), "ECE");
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

test("Map covers all 28 syllabi", () => {
  ok(Object.keys(CLIENT_MAP).length >= 28, "expected at least 28 syllabi mapped");
});

test("studioSubjectToKbSubject returns the canonical key", () => {
  eq(studioSubjectToKbSubject("Mathematics Syllabus (Forms 1-4)"), "mathematics");
  eq(studioSubjectToKbSubject("Physics Syllabus (Forms 1-4)"), "physics");
  eq(studioSubjectToKbSubject("Made-up subject"), "");
});

test("Forms 1-4 additions map to their canonical subject keys", () => {
  eq(studioSubjectToKbSubject("Art & Design Syllabus (Forms 1-4)"), "art_and_design");
  eq(studioSubjectToKbSubject("Zambian Languages Syllabus (Forms 1-4)"), "zambian_language");
  eq(studioSubjectToKbSubject("Commerce & Principles of Accounts Syllabus (Forms 1-4)"), "commerce_and_principles_of_accounts");
  eq(studioSubjectToKbSubject("Design & Technology Studies Syllabus (Forms 1-4)"), "design_and_technology_studies");
  eq(studioSubjectToKbSubject("Music & Creative Arts Syllabus (Forms 1-4)"), "music_and_creative_arts");
  eq(studioSubjectToKbSubject("Biology Syllabus (Forms 1-4)"), "biology");
  eq(studioSubjectToKbSubject("Agricultural Science Syllabus (Forms 1-4)"), "agricultural_science");
  eq(studioSubjectToKbSubject("English Syllabus (Forms 1-4)"), "english");
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

test("Header-echo rows (the repeated column header) are dropped", () => {
  // The CDC PDFs repeat the column-header line at page breaks; ingestion
  // captures it as a data row {TOPIC:"TOPIC", "SUB-TOPIC":"SUB-TOPIC", ...}.
  // It must never surface as a "TOPIC" topic with a "SUB-TOPIC" sub-topic.
  const out = rowsWithPropagatedTopic([
    {type: "data", cells: {TOPIC: "1.1 Numbers", "SUB-TOPIC": "Counting"}},
    {type: "data", cells: {
      TOPIC: "TOPIC", "SUB-TOPIC": "SUB-TOPIC",
      "SPECIFIC COMPETENCES": "SPECIFIC COMPETENCES",
      "LEARNING ACTIVITIES": "LEARNING ACTIVITIES",
      "EXPECTED STANDARD": "EXPECTED STANDARD",
    }},
    {type: "data", cells: {TOPIC: "1.2 Operations", "SUB-TOPIC": "Addition"}},
  ]);
  eq(out.length, 2);
  eq(out.map((r) => r.topic), ["1.1 Numbers", "1.2 Operations"]);
});

test("Empty strand banners mis-tagged as topics are dropped", () => {
  // "READING" / "WRITING" are strand headings captured as TOPIC rows with no
  // sub-topic and no content — they aren't real topics and must be dropped.
  const out = rowsWithPropagatedTopic([
    {type: "data", cells: {TOPIC: "1.1 Conversation", "SUB-TOPIC": "Greetings"}},
    {type: "data", cells: {TOPIC: "READING", "SUB-TOPIC": ""}},
    {type: "data", cells: {TOPIC: "1.9 Sounds", "SUB-TOPIC": "Short Vowels"}},
  ]);
  eq(out.map((r) => r.topic), ["1.1 Conversation", "1.9 Sounds"]);
});

test("A topic with content but no sub-topic is kept (ICT/PE style)", () => {
  // Some senior-secondary topics (ICT "Cybersecurity", PE "Nutrition") carry
  // competences/activities but no separate SUB-TOPIC cell — those are real
  // and must survive the banner filter.
  const out = rowsWithPropagatedTopic([
    {type: "data", cells: {
      TOPIC: "Cybersecurity", "SUB-TOPIC": "",
      "SPECIFIC COMPETENCES": "Explain common threats",
    }},
  ]);
  eq(out.length, 1);
  eq(out[0].topic, "Cybersecurity");
});

test("Page-break continuation rows join the previous row's activities", () => {
  // The CDC PDFs split a LEARNING ACTIVITIES cell across a page break —
  // ingestion captures the tail as its own row with no sub-topic and no
  // competence (real case: Literature in English Form 1 "1.2.2.2. Prose").
  // The fragment must rejoin the previous row, healed when cut mid-phrase.
  const out = rowsWithPropagatedTopic([
    {type: "data", cells: {
      TOPIC: "1.2 Genres", "SUB-TOPIC": "1.2.2.2. Prose",
      "SPECIFIC COMPETENCES": "Analyse prose structure",
      "LEARNING ACTIVITIES": "• Discussing prose and its structure organised in paragraphs and",
    }},
    {type: "data", cells: {
      TOPIC: "", "SUB-TOPIC": "", "SPECIFIC COMPETENCES": "",
      "LEARNING ACTIVITIES": "chapter: fiction and non-fiction, exposition, rising action",
    }},
    {type: "data", cells: {TOPIC: "", "SUB-TOPIC": "1.2.2.3. Drama", "SPECIFIC COMPETENCES": "X"}},
  ]);
  eq(out.length, 2); // the fragment row merged, not emitted
  ok(out[0].learningActivities.includes("paragraphs and chapter: fiction"),
      `mid-phrase fragment healed: ${out[0].learningActivities}`);
  eq(out[1].subtopic, "1.2.2.3. Drama");
});

test("Joined multi-code competences split into separate KB outcomes (ECE)", () => {
  const fixture = {
    "Early Childhood Education Syllabi (3-5 Years)": {
      "3-4 Years - Zambian Languages": {
        columns: ["TOPIC", "SUB-TOPIC", "SPECIFIC COMPETENCES", "LEARNING ACTIVITIES", "EXPECTED STANDARD"],
        rows: [
          {type: "data", cells: {
            TOPIC: "0.1.1 Oral Language", "SUB-TOPIC": "0.1.1.6 Objects at home",
            "SPECIFIC COMPETENCES": "0.1.1.6.1 Name objects in the home environment 0.1.1.6.2 Use appropriate language to state the functions of objects in the home environment",
          }},
        ],
      },
    },
  };
  const topics = syllabiToKbTopics(fixture);
  eq(topics.length, 1);
  eq(topics[0].specificOutcomes.length, 2);
  ok(topics[0].specificOutcomes[0].startsWith("0.1.1.6.1 Name objects"),
      topics[0].specificOutcomes[0]);
  ok(topics[0].specificOutcomes[1].startsWith("0.1.1.6.2 Use appropriate"),
      topics[0].specificOutcomes[1]);
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

test("Real data: no ingestion-artifact topics leak into the KB", async () => {
  // Guards the Notes/teacher-studio topic pickers: the repeated column-header
  // line ("TOPIC") and the empty strand banners ("READING"/"WRITING"/…) must
  // not appear as selectable topics. A leaked banner carries no sub-topics;
  // a genuine topic that happens to share a banner's name (the Zambian
  // Languages Forms 1-4 syllabus has a real "Vocabulary" topic with a
  // "Word Meaning" sub-topic) does, and must be kept.
  const topics = await getCurriculumDataTopics(null);
  const bad = topics.filter((t) =>
    ["TOPIC", "SUB-TOPIC", "READING", "WRITING", "VOCABULARY", "COMPREHENSION", "PRE-READING", "PRE-WRITING"]
        .includes(String(t.topic || "").trim().toUpperCase()) &&
    !(Array.isArray(t.subtopics) && t.subtopics.length > 0),
  );
  if (bad.length) {
    throw new Error(`leaked artifact topics: ${bad.map((t) => `${t.grade}/${t.subject}/${t.topic}`).join(", ")}`);
  }
});

test("Real data: the Forms 1-4 additions produce topics at G8-G11", () => {
  // The CBC secondary syllabi ingested from the CDC workbooks (Art & Design,
  // Zambian Languages, Commerce & Principles of Accounts, Design & Technology
  // Studies, Music & Creative Arts) must resolve through STUDIO_SUBJECT_TO_KB
  // and surface topics for every form.
  //
  // The Commerce & Principles of Accounts workbook holds TWO syllabi, so it
  // surfaces under two keys, not the combined one — and the combined key must
  // produce nothing at all (asserted below).
  const raw = loadRawData();
  const topics = syllabiToKbTopics(raw);
  const subjects = [
    "art_and_design",
    "zambian_language",
    "commerce",
    "principles_of_accounts",
    "design_and_technology_studies",
    "music_and_creative_arts",
    "biology",
    "agricultural_science",
    "english",
  ];
  for (const subject of subjects) {
    for (const grade of ["G8", "G9", "G10", "G11"]) {
      ok(
        topics.some((t) => t.subject === subject && t.grade === grade),
        `expected ${subject} topics at ${grade}`,
      );
    }
  }
  // The combined key is retired: nothing may still be filed under it, or the
  // split silently only half-happened.
  ok(
    !topics.some((t) => t.subject === "commerce_and_principles_of_accounts"),
    "no topic may remain under the retired combined key",
  );
  // Food & Nutrition likewise no longer arrives as home_economics at Forms 1-4.
  ok(
    topics.some((t) => t.subject === "food_and_nutrition" && t.grade === "G8"),
    "expected food_and_nutrition topics at G8",
  );
});

test("Real data: Commerce 1.1 and Principles of Accounts 1.1 stay independent", () => {
  // The reason for the split: both syllabi number from 1.1 and are supposed to.
  // Each code must resolve to exactly ONE topic within its own subject.
  const topics = syllabiToKbTopics(loadRawData());
  const at = (subject, grade) => topics.filter((t) => t.subject === subject && t.grade === grade);

  const commerce = at("commerce", "G8");
  const accounts = at("principles_of_accounts", "G8");
  ok(commerce.some((t) => t.topic === "1.1 Commerce"), "Commerce owns 1.1 Commerce");
  ok(accounts.some((t) => t.topic === "1.1 Principles of Accounts"), "PoA owns 1.1 Principles of Accounts");
  // Neither subject may contain the other's 1.1 — that is the collision itself.
  ok(!commerce.some((t) => t.topic === "1.1 Principles of Accounts"), "Commerce must not hold PoA's 1.1");
  ok(!accounts.some((t) => t.topic === "1.1 Commerce"), "PoA must not hold Commerce's 1.1");

  // And within each subject the code 1.1 is claimed exactly once, so a 1.1.x
  // sub-topic has a single unambiguous parent.
  for (const [label, rows] of [["commerce", commerce], ["principles_of_accounts", accounts]]) {
    const ones = rows.filter((t) => /^1\.1(\s|$)/.test(t.topic));
    ok(ones.length === 1, `${label} G8 must claim code 1.1 exactly once, saw ${ones.length}`);
  }
});

test("Real data: Grade 1 English topics are the 1.x list, banners stripped", () => {
  const raw = loadRawData();
  const topics = syllabiToKbTopics(raw)
      .filter((t) => t.grade === "G1" && t.subject === "english")
      .map((t) => t.topic);
  ok(topics.includes("1.1 CONVERSATION"), "keeps 1.1 CONVERSATION");
  ok(topics.includes("1.9 SOUNDS"), "keeps 1.9 SOUNDS");
  ok(!topics.includes("READING"), "drops READING banner");
  ok(!topics.includes("WRITING"), "drops WRITING banner");
  ok(!topics.includes("TOPIC"), "drops TOPIC header echo");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
