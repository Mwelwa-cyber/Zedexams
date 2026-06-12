#!/usr/bin/env node
/**
 * Copies the canonical curriculum data files the teacher Syllabi Library
 * reads from /public into the place Cloud Functions need them on deploy.
 *
 *   public/syllabi/curriculum-data.json       →  functions/data/curriculum-data.json
 *   public/syllabi/curriculum-data-2013.json  →  functions/data/curriculum-data-2013.json
 *
 * Cloud Functions deploys only ship files inside the `functions/` package,
 * so the server-side loader (`functions/teacherTools/syllabiCurriculumData.js`)
 * can't reach the public asset at runtime. Keeping copies under functions/
 * is the simplest path; this script is the canonical way to refresh them.
 *
 * Run manually: `npm run sync:syllabus-data`
 * CI guard:     `npm run test:syllabus-data-sync` (asserts byte-equal)
 */

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FILES = [
  {
    src: join(ROOT, "public", "syllabi", "curriculum-data.json"),
    dst: join(ROOT, "functions", "data", "curriculum-data.json"),
    required: true,
  },
  {
    src: join(ROOT, "public", "syllabi", "curriculum-data-2013.json"),
    dst: join(ROOT, "functions", "data", "curriculum-data-2013.json"),
    // 2013 file is optional during the rollout window — don't fail the
    // sync if it hasn't landed yet on a given branch.
    required: false,
  },
];

function size(p) {
  try { return statSync(p).size; } catch { return null; }
}

let failed = 0;
for (const { src, dst, required } of FILES) {
  if (!existsSync(src)) {
    if (required) {
      console.error(`ERROR: missing required source ${src}`);
      failed += 1;
    } else {
      console.log(`skip ${src} (not present — optional)`);
    }
    continue;
  }
  const buf = readFileSync(src);
  writeFileSync(dst, buf);
  const srcSize = size(src);
  const dstSize = size(dst);
  console.log(`Synced ${src} → ${dst}`);
  console.log(`  source: ${srcSize} bytes`);
  console.log(`  dest:   ${dstSize} bytes`);
  if (srcSize !== dstSize) {
    console.error("ERROR: post-sync size mismatch.");
    failed += 1;
  }
}
if (failed) process.exit(1);
