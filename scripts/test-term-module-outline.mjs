#!/usr/bin/env node
/**
 * Term-module-outline + dual-source curriculum tests.
 *
 * Locks in the "uploaded modules as an additional curriculum source" feature:
 *
 *   1. renderSourceReconciliation() emits the <curriculum_sources> directive
 *      that tells the model to reconcile the syllabus outline with the module.
 *   2. renderCurriculumModuleBlock(..., { paired }) drops the "single source of
 *      truth" wording when a syllabus block is shown alongside it, so the two
 *      blocks don't contradict each other.
 *   3. renderTermModuleOutline() lays out topics → sub-topics with their
 *      competences/activities/standards for the Scheme of Work prompt.
 *   4. resolveTermModuleOutline() reads the term's modules from Firestore,
 *      filters to the requested term, and shapes them as official 9-column
 *      scheme weeks (what the Weekly Forecast consumes).
 *
 * Run: node scripts/test-term-module-outline.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Module from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const KB = join(ROOT, "functions/teacherTools/cbcKnowledge.js");

// ── A controllable fake Firestore: feed it the topic cards + their lessons,
// it answers the exact call chain lookupTermModules() makes. ──
let FAKE_TOPICS = []; // [{ data, lessons: [{ id, ...moduleFields }] }]

function lessonsCollection(lessons) {
  let term = null;
  const q = {
    where: (field, _op, val) => { if (field === "term") term = Number(val); return q; },
    limit: () => q,
    get: async () => {
      const docs = lessons
        .filter((l) => term === null || Number(l.term) === term)
        .map((l) => ({ id: l.id, data: () => l }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
  return q;
}

function topicsQuery() {
  const q = {
    where: () => q,
    limit: () => q,
    get: async () => {
      const docs = FAKE_TOPICS.map((t) => ({
        id: t.data.id || "topic",
        data: () => t.data,
        ref: { collection: () => lessonsCollection(t.lessons) },
      }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
  };
  return q;
}

const fakeAdmin = {
  firestore: () => ({
    // getActiveKbState reads cbcKnowledgeBase/_meta → exists:false → default ver.
    doc: () => ({ get: async () => ({ exists: false, data: () => ({}) }) }),
    collection: () => ({
      doc: () => ({ collection: () => topicsQuery() }),
    }),
  }),
};
fakeAdmin.firestore.FieldValue = { serverTimestamp: () => "__ts__" };

const origError = console.error;
console.error = (...args) => {
  const first = args[0];
  if (typeof first === "string" &&
      /failed/.test(first)) return;
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

// ── 1. renderSourceReconciliation ──
console.log("renderSourceReconciliation");
const recon = kb.renderSourceReconciliation();
check("opens the <curriculum_sources> block", recon.includes("<curriculum_sources>"));
check("closes the block", recon.includes("</curriculum_sources>"));
check("names both sources (syllabus + module)",
  /syllabus/i.test(recon) && /module/i.test(recon));
check("tells the model to reconcile", /reconcile/i.test(recon));

// ── 2. renderCurriculumModuleBlock paired vs unpaired ──
console.log("\nrenderCurriculumModuleBlock — paired wording");
const sampleModule = {
  grade: "G5", subject: "mathematics", term: 2,
  topic: "Fractions", subtopic: "Adding fractions",
  outcomes: ["Add fractions with like denominators"],
  competencies: ["Numeracy"],
  learnerActivities: ["Adding paper-strip fractions"],
  teacherActivities: ["Demonstrating with strips"],
  teachingMaterials: ["Paper strips"],
  assessmentCriteria: ["Fractions added correctly"],
};
const unpaired = kb.renderCurriculumModuleBlock(sampleModule, {});
const paired = kb.renderCurriculumModuleBlock(sampleModule, { paired: true });
check("unpaired keeps 'single source of truth'",
  /single source of truth/i.test(unpaired));
check("paired drops 'single source of truth'",
  !/single source of truth/i.test(paired));
check("paired still references the syllabus outline above",
  /syllabus/i.test(paired));
check("both render the sub-topic", unpaired.includes("Adding fractions") &&
  paired.includes("Adding fractions"));

// ── 3. renderTermModuleOutline ──
console.log("\nrenderTermModuleOutline");
const outlineStruct = {
  topics: [
    {
      topic: "Fractions",
      subtopics: [
        {
          subtopic: "Adding fractions",
          outcomes: ["Add fractions with like denominators"],
          competencies: ["Numeracy"],
          learnerActivities: ["Adding paper-strip fractions"],
          assessmentCriteria: ["Fractions added correctly"],
          teachingMaterials: ["Paper strips"],
        },
      ],
    },
  ],
};
const outlineText = kb.renderTermModuleOutline(outlineStruct,
  { grade: "G5", subject: "mathematics", term: 2 });
check("opens the <term_module_outline> block", outlineText.includes("<term_module_outline>"));
check("lists the TOPIC", outlineText.includes("TOPIC: Fractions"));
check("lists the sub-topic", outlineText.includes("Sub-topic: Adding fractions"));
check("includes the specific competence", /Add fractions with like denominators/.test(outlineText));
check("includes the learning activity", /Adding paper-strip fractions/.test(outlineText));
check("empty outline renders nothing", kb.renderTermModuleOutline({ topics: [] }) === "");

// ── 4. resolveTermModuleOutline reads + shapes the term's modules ──
console.log("\nresolveTermModuleOutline — reads + shapes term modules");
FAKE_TOPICS = [
  {
    data: { id: "g5-mathematics-fractions", grade: "G5", subject: "mathematics", topic: "Fractions" },
    lessons: [
      {
        id: "adding-fractions-t2", grade: "G5", subject: "mathematics", term: 2,
        topic: "Fractions", subtopic: "Adding fractions",
        outcomes: ["Add fractions with like denominators"],
        competencies: ["Numeracy"],
        learnerActivities: ["Adding paper-strip fractions"],
        teacherActivities: ["Demonstrating with strips"],
        teachingMaterials: ["Paper strips", "Number line"],
        assessmentCriteria: ["Fractions added correctly"],
      },
      {
        // Different term — must be filtered out for a Term 2 request.
        id: "subtracting-fractions-t1", grade: "G5", subject: "mathematics", term: 1,
        topic: "Fractions", subtopic: "Subtracting fractions",
        outcomes: ["Subtract fractions"],
      },
    ],
  },
];

const resolved = await kb.resolveTermModuleOutline({
  grade: "G5", subject: "mathematics", term: 2,
});
check("returns a result when modules exist", Boolean(resolved));
check("topicsCount is 1", resolved && resolved.topicsCount === 1, resolved && String(resolved.topicsCount));
check("subtopicsCount is 1 (term filtered)", resolved && resolved.subtopicsCount === 1,
  resolved && String(resolved.subtopicsCount));
check("outlineBlock mentions the term-2 sub-topic",
  resolved && resolved.outlineBlock.includes("Adding fractions"));
check("outlineBlock excludes the term-1 sub-topic",
  resolved && !resolved.outlineBlock.includes("Subtracting fractions"));

const wk = resolved && resolved.weeks && resolved.weeks[0];
check("weeks[0] is shaped like an official scheme week", Boolean(wk && wk.topic && wk.subtopic));
check("specificCompetences merges outcomes + competencies",
  wk && wk.specificCompetences.includes("Add fractions with like denominators") &&
  wk.specificCompetences.includes("Numeracy"));
check("learningActivities come from learnerActivities",
  wk && wk.learningActivities.includes("Adding paper-strip fractions"));
check("expectedStandard comes from assessmentCriteria",
  wk && /Fractions added correctly/.test(wk.expectedStandard));
check("tlAids come from teachingMaterials",
  wk && wk.tlAids.includes("Paper strips"));

// ── 5. resolveTermModuleOutline returns null when nothing is uploaded ──
console.log("\nresolveTermModuleOutline — no modules");
FAKE_TOPICS = [];
const none = await kb.resolveTermModuleOutline({ grade: "G6", subject: "english", term: 3 });
check("returns null when no topics exist", none === null);

console.log("");
if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("All term-module-outline checks passed.");
