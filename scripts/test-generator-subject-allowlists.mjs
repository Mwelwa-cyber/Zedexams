#!/usr/bin/env node
/**
 * Guard: every teacher-tool generator's ALLOWED_SUBJECTS set accepts the
 * canonical subject keys the Syllabus Studio exposes.
 *
 * Each generator keeps its own copy of the allowlist (plus the shared
 * assessmentAllowlists.js), so a new syllabus subject can land in the
 * pickers while some generators still reject it with "Please select a
 * supported subject" — exactly what happened when the CBC Forms 1-4
 * subjects (PR #1697) reached six generators but not generateQuiz /
 * generateSlideNotes / generateLessonActivities / generateLessonPlan.
 * This test scans every ALLOWED_SUBJECTS block under functions/teacherTools
 * and fails when one of them is missing a required key.
 *
 * Text-level on purpose: requiring the generator modules pulls in
 * firebase-functions, which the root-only test:all job doesn't install.
 *
 * Run: npm run test:generator-subject-allowlists (also via test:all).
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = join(__dirname, "..", "functions", "teacherTools");

// Keys every generator must accept: a couple of long-standing core subjects
// (proves the block parser actually reads the sets) plus the CBC 2023
// Forms 1-4 additions.
const REQUIRED_KEYS = [
  "mathematics",
  "english",
  "art_and_design",
  "commerce_and_principles_of_accounts",
  "design_and_technology_studies",
  "music_and_creative_arts",
];

// assessmentAllowlists.js + the ten generate*.js copies as of this writing.
// A shrinking count means the scan regex went stale, not that the repo
// genuinely lost an allowlist — fail loudly either way.
const MIN_EXPECTED_FILES = 11;

const failures = [];
let scanned = 0;

for (const name of readdirSync(TOOLS_DIR).sort()) {
  if (!name.endsWith(".js") || name.endsWith(".test.js")) continue;
  const source = readFileSync(join(TOOLS_DIR, name), "utf8");
  const match = source.match(/ALLOWED_SUBJECTS = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) continue;
  scanned += 1;
  const keys = new Set(
    Array.from(match[1].matchAll(/"([^"]+)"/g), (m) => m[1]),
  );
  for (const required of REQUIRED_KEYS) {
    if (!keys.has(required)) {
      failures.push(`${name}: ALLOWED_SUBJECTS is missing "${required}"`);
    }
  }
}

if (scanned < MIN_EXPECTED_FILES) {
  failures.push(
    `only ${scanned} ALLOWED_SUBJECTS blocks found under functions/teacherTools ` +
    `(expected at least ${MIN_EXPECTED_FILES}) — did the declaration shape change?`,
  );
}

if (failures.length > 0) {
  console.error("generator-subject-allowlists FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `✓ generator-subject-allowlists: ${scanned} allowlists accept all ` +
  `${REQUIRED_KEYS.length} required subject keys`,
);
