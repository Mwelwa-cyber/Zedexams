#!/usr/bin/env node
/**
 * Copies the canonical curriculum data file the teacher Syllabi Library
 * reads from /public into the place Cloud Functions need it on deploy.
 *
 *   public/syllabi/curriculum-data.json  →  functions/data/curriculum-data.json
 *
 * Cloud Functions deploys only ship files inside the `functions/` package,
 * so the server-side loader (`functions/teacherTools/syllabiCurriculumData.js`)
 * can't reach the public asset at runtime. Keeping a copy under functions/
 * is the simplest path; this script is the canonical way to refresh it.
 *
 * Run manually: `npm run sync:syllabus-data`
 * CI guard:     `npm run test:syllabus-data-sync` (asserts byte-equal)
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "public", "syllabi", "curriculum-data.json");
const DST = join(ROOT, "functions", "data", "curriculum-data.json");

function size(p) {
  try { return statSync(p).size; } catch { return null; }
}

const src = readFileSync(SRC);
writeFileSync(DST, src);
const srcSize = size(SRC);
const dstSize = size(DST);
console.log(`Synced ${SRC} → ${DST}`);
console.log(`  source: ${srcSize} bytes`);
console.log(`  dest:   ${dstSize} bytes`);
if (srcSize !== dstSize) {
  console.error("ERROR: post-sync size mismatch.");
  process.exit(1);
}
