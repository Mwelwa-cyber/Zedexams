#!/usr/bin/env node
/**
 * Drift guard for the curriculum-data.json copy under functions/data/.
 *
 * The teacher Syllabi Library reads from /public/syllabi/. The Cloud
 * Functions runtime needs the same data inside its own package (deploys
 * don't ship files from /public). To keep the two in lock-step we hold
 * a copy at functions/data/curriculum-data.json and refresh it via
 * `npm run sync:syllabus-data`.
 *
 * This script asserts the two files are byte-identical so CI fails fast
 * when someone forgets to run the sync after editing the public one.
 *
 * Run: `npm run test:syllabus-data-sync` (also via `npm run test:all`).
 */

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC_PATH = join(ROOT, "public", "syllabi", "curriculum-data.json");
const FUNCTIONS_PATH = join(ROOT, "functions", "data", "curriculum-data.json");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

let failed = 0;
function fail(msg) { console.error(`FAIL: ${msg}`); failed++; }

let pubBuf, fnBuf;
try { pubBuf = readFileSync(PUBLIC_PATH); }
catch (err) { fail(`could not read ${PUBLIC_PATH}: ${err.message}`); }
try { fnBuf = readFileSync(FUNCTIONS_PATH); }
catch (err) {
  fail(`could not read ${FUNCTIONS_PATH}: ${err.message}\n` +
       `Run: npm run sync:syllabus-data`);
}

if (pubBuf && fnBuf) {
  const pubHash = sha256(pubBuf);
  const fnHash = sha256(fnBuf);
  console.log(`public:    ${statSync(PUBLIC_PATH).size} bytes  sha256=${pubHash.slice(0, 12)}`);
  console.log(`functions: ${statSync(FUNCTIONS_PATH).size} bytes  sha256=${fnHash.slice(0, 12)}`);
  if (pubHash !== fnHash) {
    fail("curriculum-data.json copies have drifted.\n" +
         "Run: npm run sync:syllabus-data");
  } else {
    console.log("ok  files are byte-identical");
  }
}

console.log(`\n${failed === 0 ? "1 passed" : `${failed} failed`}\n`);
if (failed > 0) process.exit(1);
