#!/usr/bin/env node
/**
 * cbcKnowledge framework-awareness tests.
 *
 * Locks in three things the project owner explicitly asked for:
 *
 *   1. The Lower/Upper Primary band split for the 2023 framework
 *      (ECE-G3 = Lower Primary, G4+ = Upper Primary).
 *   2. Grade 4 has 7 official subjects under the 2023 framework
 *      (Mathematics, Science, Social Studies, Technology Studies,
 *      Home Economics, Expressive Arts, English) — RE and Creative
 *      Arts are NOT in this list.
 *   3. The fallback prompt the AI sees mentions the 2023 framework,
 *      names the band, and refuses to invent a syllabus for a
 *      subject that isn't part of the grade.
 *
 * Run: node scripts/test-cbc-framework-awareness.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Module from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const KB = join(ROOT, "functions/teacherTools/cbcKnowledge.js");

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
      /fetchCandidateChunks failed|fetchFirestoreTopics failed|getCurriculumDataTopics failed/.test(first)) {
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

console.log("getGradeBand — 2023 framework split");
check("ECE is Lower Primary", kb.getGradeBand("ECE") === "Lower Primary (Pre-Primary)");
check("G1 is Lower Primary", kb.getGradeBand("G1") === "Lower Primary");
check("G3 is Lower Primary", kb.getGradeBand("G3") === "Lower Primary");
check("G4 is Upper Primary", kb.getGradeBand("G4") === "Upper Primary");
check("G7 is Upper Primary", kb.getGradeBand("G7") === "Upper Primary");
check("G8 is Junior Secondary", kb.getGradeBand("G8") === "Junior Secondary");
check("G10 is Senior Secondary", kb.getGradeBand("G10") === "Senior Secondary");
check("Grade 4 (long form) resolves to Upper Primary",
  kb.getGradeBand("Grade 4") === "Upper Primary");
check("'4' (bare digit) resolves to Upper Primary",
  kb.getGradeBand("4") === "Upper Primary");
check("Unknown grade returns null", kb.getGradeBand("Kindergarten") === null);

console.log("\ngetOfficialSubjectsForGrade — Grade 4 verified subject list");
const g4 = kb.getOfficialSubjectsForGrade("G4");
check("G4 has a subject list", Array.isArray(g4));
check("G4 has exactly 7 subjects", g4 && g4.length === 7,
  g4 && `got ${g4.length}: ${g4.join(", ")}`);
for (const s of [
  "english", "mathematics", "integrated_science", "social_studies",
  "technology_studies", "home_economics", "expressive_arts",
]) {
  check(`G4 includes ${s}`, g4 && g4.includes(s));
}
check("G4 does NOT include religious_education",
  g4 && !g4.includes("religious_education"));
check("G4 does NOT include cinyanja (not part of new G4)",
  g4 && !g4.includes("cinyanja"));
check("G5 returns null (not yet verified, validation disabled)",
  kb.getOfficialSubjectsForGrade("G5") === null);

console.log("\nclassifySubjectForGrade");
check("(G4, Mathematics) → in_syllabus",
  kb.classifySubjectForGrade("G4", "Mathematics") === "in_syllabus");
check("(G4, Integrated Science) → in_syllabus",
  kb.classifySubjectForGrade("G4", "Integrated Science") === "in_syllabus");
check("(G4, Expressive Arts) → in_syllabus (valid subject; data may be missing)",
  kb.classifySubjectForGrade("G4", "Expressive Arts") === "in_syllabus");
check("(G4, Religious Education) → not_in_grade",
  kb.classifySubjectForGrade("G4", "Religious Education") === "not_in_grade");
check("(G4, Creative Arts) → not_in_grade",
  kb.classifySubjectForGrade("G4", "Creative Arts") === "not_in_grade");
check("(G5, anything) → unknown (no verified list for G5)",
  kb.classifySubjectForGrade("G5", "Mathematics") === "unknown");

console.log("\nrenderFallbackContext — framework + band shown to AI");
const fc1 = kb.renderFallbackContext({
  grade: "G4", subject: "Mathematics", topic: "Whole Numbers",
});
check("mentions 2023 framework", /2023 framework/.test(fc1));
check("mentions Upper Primary band", /Upper Primary/.test(fc1));
check("mentions Lower Primary structure", /Lower Primary: ECE/.test(fc1));
check("no longer references 2013 framework as the default",
  !/2013 framework/.test(fc1));

console.log("\nrenderFallbackContext — subject NOT in grade syllabus");
const fc2 = kb.renderFallbackContext({
  grade: "G4", subject: "Religious Education", topic: "Christianity",
});
check("flags subject as NOT in grade syllabus", /NOT one of the official/.test(fc2));
check("lists the official Grade 4 subjects", /expressive_arts/.test(fc2));
check("forbids fabricating a syllabus", /Do NOT fabricate/.test(fc2));

console.log("\nrenderFallbackContext — subject IS in syllabus but topic missing");
const fc3 = kb.renderFallbackContext({
  grade: "G4", subject: "Expressive Arts", topic: "Rhythm & Beats",
});
check("acknowledges subject is part of the grade",
  /IS part of the official Grade 4/.test(fc3));
check("does not fire the 'not in grade' warning here",
  !/NOT one of the official/.test(fc3));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll framework-awareness checks passed.");
