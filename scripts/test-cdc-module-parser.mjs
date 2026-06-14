#!/usr/bin/env node
/**
 * cdcModuleParser tests — the pure text→modules core used by
 * scripts/curriculum/parse-cdc-module.mjs to turn CDC teaching-module PDFs
 * into curriculum-module JSON. Runs on synthetic text (no PDF needed) and
 * validates every produced module against the real curriculum-module schema,
 * so the importer and the parser can never drift apart.
 *
 * Run: node scripts/test-cdc-module-parser.mjs
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCdcModule, cleanLines, stripBoilerplate } from "./curriculum/cdcModuleParser.mjs";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { validateCurriculumModule } =
  require(join(__dirname, "..", "functions", "teacherTools", "curriculumModuleSchema.js"));

let failed = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ok   ${label}`);
  else { failed += 1; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── decimal layout (Civic-style), with TOC + glued headers + running header ──
const decimalDoc = [
  "1.1 INTRODUCTION TO CIVIC EDUCATION ............... 9", // TOC line, dropped
  "CIVIC EDUCATION TEACHING MODULE 9",
  "1.1 INTRODUCTION TO CIVIC EDUCATION",
  "General Competences",
  "Citizenship Demonstrate understanding of Civic Education",
  "1.1.1 Civic EducationIntroduction Civic education refers to teaching citizens.",
  "1.1.1.1 Specific Competence",
  "Learners to: Demonstrate understanding of Civic Education",
  "Teaching and Learning Materials: Chart showing themes, posters",
  "Expected Standard Understanding of Civic Education demonstrated appropriately.",
  "Assessment 1. Explain the concept Civic Education.",
].join("\n");

console.log("decimal layout (Civic-style)");
const dec = parseCdcModule(decimalDoc, { grade: "G8", subject: "civic_education", term: 1 });
check("one sub-topic parsed", dec.modules.length === 1, String(dec.modules.length));
const dm = dec.modules[0] || {};
check("topic keeps the subject name in its title",
  dm.topic === "1.1 INTRODUCTION TO CIVIC EDUCATION", dm.topic);
check("sub-topic captured", dm.subtopic === "1.1.1 Civic Education", dm.subtopic);
check("outcome captured without the 'Learners to:' prefix",
  Array.isArray(dm.outcomes) && dm.outcomes[0] === "Demonstrate understanding of Civic Education",
  JSON.stringify(dm.outcomes));
check("materials captured and split", dm.teachingMaterials.includes("Chart showing themes"),
  JSON.stringify(dm.teachingMaterials));
check("expected standard captured", /demonstrated appropriately/.test(dm.assessmentCriteria.join(" ")));
check("outcome did NOT absorb the materials line",
  !dm.outcomes.join(" ").includes("Chart"));
check("schema-valid", validateCurriculumModule(dm).ok);

// ── labelled layout (Commerce-style) ──
const labelledDoc = [
  "TOPIC: PRODUCTION",
  "General Competence(s):",
  "Sub-Topic 1- Stages of Production",
  "Specific Competence: Demonstrate knowledge of stages of production",
  "Learning Activity 1: Explaining production",
  "Teaching and Learning Materials: real objects, charts",
  "Expected Standard - Knowledge of stages of production demonstrated accordingly 9",
  "Assessment: Outline the three stages of production.",
].join("\n");

console.log("\nlabelled layout (Commerce-style)");
const lab = parseCdcModule(labelledDoc, { grade: "G8", subject: "commerce", term: 1 });
check("one sub-topic parsed", lab.modules.length === 1, String(lab.modules.length));
const lm = lab.modules[0] || {};
check("topic captured", lm.topic === "PRODUCTION", lm.topic);
check("sub-topic captured", lm.subtopic === "Stages of Production", lm.subtopic);
check("inline specific competence captured",
  lm.outcomes[0] === "Demonstrate knowledge of stages of production", JSON.stringify(lm.outcomes));
check("expected standard drops the trailing page number",
  lm.assessmentCriteria.join(" ") === "Knowledge of stages of production demonstrated accordingly",
  JSON.stringify(lm.assessmentCriteria));
check("schema-valid", validateCurriculumModule(lm).ok);

// ── implicit sub-topic + in-document TERM divider (Grade-1 / combined doc) ──
const dividerDoc = [
  "TOPIC: 1.6 SOUNDS",
  "Specific Competence(s): 1.6.1.1 Produce different soundsLearning environment: Indoor",
  "Expected Standard: Different sounds produced accordingly.",
  "TERM 2",
  "TOPIC: 1.7 DRAMA",
  "Specific Competence: Practice simple plays.",
  "Expected Standard: Simple plays practiced accordingly.",
].join("\n");

console.log("\nimplicit sub-topic + TERM divider");
const div = parseCdcModule(dividerDoc, { grade: "G1", subject: "creative_and_technology_studies", term: 1 });
check("two sub-topics parsed", div.modules.length === 2, String(div.modules.length));
check("first is Term 1", div.modules[0] && div.modules[0].term === 1, String(div.modules[0] && div.modules[0].term));
check("second is Term 2 (divider switched the term)",
  div.modules[1] && div.modules[1].term === 2, String(div.modules[1] && div.modules[1].term));
check("topic with no explicit sub-topic gets an implicit one",
  div.modules[0].subtopic === "1.6 SOUNDS", div.modules[0].subtopic);
check("outcome did NOT absorb 'Learning environment:'",
  div.modules[0].outcomes[0] === "Produce different sounds" &&
  !div.modules[0].outcomes.join(" ").includes("Indoor"),
  JSON.stringify(div.modules[0].outcomes));
check("all divider-doc modules schema-valid",
  div.modules.every((m) => validateCurriculumModule(m).ok));

// ── unit helpers ──
console.log("\nhelpers");
check("stripBoilerplate removes '<subject> teaching module' as a unit",
  !/teaching module/i.test(stripBoilerplate("CIVIC EDUCATION TEACHING MODULE 1.1 TOPIC")));
check("stripBoilerplate keeps a bare subject name inside a title",
  /CIVIC EDUCATION/.test(stripBoilerplate("1.1 INTRODUCTION TO CIVIC EDUCATION")));
check("cleanLines drops TOC dot-leader rows",
  !cleanLines("1.1 Topic ............ 9\nReal body line").includes("............"));

console.log("");
if (failed > 0) { console.error(`\n${failed} check(s) failed.`); process.exit(1); }
console.log("All cdcModuleParser checks passed.");
