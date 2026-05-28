#!/usr/bin/env node
/**
 * Tests for the 2013 / 2023 framework split in the AI knowledge base.
 *
 * Covers:
 *   - syllabiCurriculumData loads BOTH curriculum-data.json (2023) and
 *     curriculum-data-2013.json (2013).
 *   - getCurriculumDataTopics(version, { framework }) returns topics
 *     stamped with the right framework field.
 *   - The 2013 schema parser handles the variable topic-code column and
 *     splits SPECIFIC OUTCOMES / KNOWLEDGE / SKILLS / VALUES correctly.
 *   - getAllTopics({ framework }) returns disjoint Studio rows per era
 *     while keeping the seed available to both (backward compat for
 *     Cala matcher etc.).
 *   - resolveCbcContext accepts a `framework` arg and surfaces it on
 *     the result + names the era in the fallback prompt.
 *
 * Run: node scripts/test-cbc-framework-split.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Module from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const KB = join(ROOT, "functions/teacherTools/cbcKnowledge.js");
const SCD = join(ROOT, "functions/teacherTools/syllabiCurriculumData.js");

function fakeQuery() {
  const empty = { docs: [], size: 0, empty: true };
  const q = {
    where: () => q, orderBy: () => q, limit: () => q,
    startAfter: () => q, get: async () => empty,
  };
  return q;
}
function fakeDoc() {
  return {
    get: async () => ({ exists: false, data: () => ({}) }),
    collection: () => fakeCollection(),
  };
}
function fakeCollection() {
  const q = fakeQuery();
  return Object.assign(q, { doc: () => fakeDoc() });
}
const fakeAdmin = {
  firestore: () => ({
    doc: () => fakeDoc(),
    collection: () => fakeCollection(),
  }),
};
fakeAdmin.firestore.FieldValue = { serverTimestamp: () => "__ts__" };

const origError = console.error;
console.error = (...args) => {
  const first = args[0];
  if (typeof first === "string" &&
      /fetchCandidateChunks failed|fetchFirestoreTopics failed/.test(first)) {
    return;
  }
  origError(...args);
};

const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === "firebase-admin") return fakeAdmin;
  return origLoad.call(this, request, parent, ...rest);
};

const kb = require(KB);
const scd = require(SCD);
Module._load = origLoad;

let failed = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("syllabiCurriculumData — normalizeFramework");
check("default is '2023'", scd.normalizeFramework() === "2023");
check("explicit '2023' is '2023'", scd.normalizeFramework("2023") === "2023");
check("explicit '2013' is '2013'", scd.normalizeFramework("2013") === "2013");
check("garbage falls back to '2023'", scd.normalizeFramework("xyz") === "2023");
check("null falls back to '2023'", scd.normalizeFramework(null) === "2023");

console.log("\nsyllabiCurriculumData — loadRawData per framework");
const raw2023 = scd.loadRawData("2023");
const raw2013 = scd.loadRawData("2013");
check("2023 raw data has the current Studio subjects", Object.keys(raw2023).length > 15,
  `got ${Object.keys(raw2023).length} top-level keys`);
check("2013 raw data has the legacy Studio subjects", Object.keys(raw2013).length > 15,
  `got ${Object.keys(raw2013).length} top-level keys`);
check("2023 has 'Mathematics Syllabus (Grades 4-6)'",
  "Mathematics Syllabus (Grades 4-6)" in raw2023);
check("2013 has 'Mathematics Syllabus (Grades 1-7, 2013)'",
  "Mathematics Syllabus (Grades 1-7, 2013)" in raw2013);
check("2023 raw does NOT contain 2013 keys",
  !("Mathematics Syllabus (Grades 1-7, 2013)" in raw2023));
check("2013 raw does NOT contain 2023 keys",
  !("Mathematics Syllabus (Grades 4-6)" in raw2013));

console.log("\ngetCurriculumDataTopics — framework filter");
const topics2023 = await scd.getCurriculumDataTopics(null, { framework: "2023" });
const topics2013 = await scd.getCurriculumDataTopics(null, { framework: "2013" });
check("2023 topics returned", topics2023.length > 50,
  `got ${topics2023.length} entries`);
check("2013 topics returned", topics2013.length > 50,
  `got ${topics2013.length} entries`);
check("every 2023 topic stamped framework='2023'",
  topics2023.every((t) => t.framework === "2023"));
check("every 2013 topic stamped framework='2013'",
  topics2013.every((t) => t.framework === "2013"));
check("2023 topics include G4 mathematics",
  topics2023.some((t) => t.grade === "G4" && t.subject === "mathematics"));
check("2013 topics include G4 mathematics",
  topics2013.some((t) => t.grade === "G4" && t.subject === "mathematics"));

console.log("\n2013 schema parser — Mathematics Grade 4");
const g4Maths2013 = topics2013.filter(
  (t) => t.grade === "G4" && t.subject === "mathematics",
);
check("G4 maths has multiple topics (4.1, 4.2, …)", g4Maths2013.length >= 8,
  `got ${g4Maths2013.length}`);
const sets = g4Maths2013.find((t) => /SETS/i.test(t.topic));
check("G4 maths includes a SETS topic", !!sets);
if (sets) {
  check("SETS topic has parsed specificOutcomes",
    Array.isArray(sets.specificOutcomes) && sets.specificOutcomes.length > 0,
    `got ${sets.specificOutcomes && sets.specificOutcomes.length} outcomes`);
  check("SETS outcomes look split (not one giant blob)",
    sets.specificOutcomes.every((s) => s.length < 400));
  check("SETS has parsed subtopics (from KNOWLEDGE)",
    Array.isArray(sets.subtopics) && sets.subtopics.length > 0);
  check("SETS has parsed key competencies (from SKILLS)",
    Array.isArray(sets.keyCompetencies) && sets.keyCompetencies.length > 0);
  check("SETS has parsed values",
    Array.isArray(sets.values) && sets.values.length > 0);
}

console.log("\ncbcKnowledge.getAllTopics({ framework }) filters by era");
const all2023 = await kb.getAllTopics({ framework: "2023" });
const all2013 = await kb.getAllTopics({ framework: "2013" });
const studio2023 = all2023.filter((t) => t._source === "syllabi_studio");
const studio2013 = all2013.filter((t) => t._source === "syllabi_studio");
check("2023 has Studio rows", studio2023.length > 0);
check("2013 has Studio rows", studio2013.length > 0);
check("2023 Studio rows are all framework='2023'",
  studio2023.every((t) => t.framework === "2023"));
check("2013 Studio rows are all framework='2013'",
  studio2013.every((t) => t.framework === "2013"));
// Seed must still be present in BOTH (backward compat for Cala matcher).
const seed2023 = all2023.filter((t) => t._source === "seed");
const seed2013 = all2013.filter((t) => t._source === "seed");
check("seed entries appear in 2023 result (backward-compat)", seed2023.length > 0,
  `got ${seed2023.length}`);
check("seed entries appear in 2013 result", seed2013.length > 0,
  `got ${seed2013.length}`);

console.log("\nresolveCbcContext — framework param flows through");
// Use a clearly-bogus topic so the resolver falls through to the fallback
// context (where the framework label is rendered). A real topic name would
// match in step 3 and we'd never see the fallback prompt.
const r23 = await kb.resolveCbcContext({
  grade: "G4", subject: "Mathematics",
  topic: "ZZ_NotARealTopic_FrameworkTestSentinel",
});
check("default framework is '2023'", r23.framework === "2023");
check("default fallback names the 2023 framework",
  /2023 framework/.test(r23.contextBlock));

const r13 = await kb.resolveCbcContext({
  grade: "G4", subject: "Mathematics",
  topic: "ZZ_NotARealTopic_FrameworkTestSentinel",
  framework: "2013",
});
check("explicit framework='2013' returned", r13.framework === "2013");
check("2013 fallback names the 2013 legacy framework",
  /2013 legacy framework/.test(r13.contextBlock));
check("2013 fallback does NOT push 2023 band structure",
  !/Upper Primary: Grade 4/.test(r13.contextBlock));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll framework-split checks passed.");
