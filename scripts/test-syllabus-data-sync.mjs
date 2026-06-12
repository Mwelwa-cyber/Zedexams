#!/usr/bin/env node
/**
 * Drift guard for the curriculum-data.json copies under functions/data/.
 *
 * The teacher Syllabi Library reads from /public/syllabi/. The Cloud
 * Functions runtime needs the same data inside its own package (deploys
 * don't ship files from /public). To keep the two in lock-step we hold
 * copies at functions/data/ and refresh them via
 * `npm run sync:syllabus-data`.
 *
 * This script asserts the two files are byte-identical so CI fails fast
 * when someone forgets to run the sync after editing the public one.
 * Both the current (2023) and legacy (2013) data files are checked.
 *
 * Run: `npm run test:syllabus-data-sync` (also via `npm run test:all`).
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const FILES = [
  {
    label: "current (2023)",
    publicPath: join(ROOT, "public", "syllabi", "curriculum-data.json"),
    fnPath: join(ROOT, "functions", "data", "curriculum-data.json"),
    required: true,
  },
  {
    label: "legacy (2013)",
    publicPath: join(ROOT, "public", "syllabi", "curriculum-data-2013.json"),
    fnPath: join(ROOT, "functions", "data", "curriculum-data-2013.json"),
    // 2013 file may not exist on every branch yet — only enforce the
    // byte-equality check when the public copy is present.
    required: false,
  },
];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

let failed = 0;
let passed = 0;
function fail(msg) { console.error(`FAIL: ${msg}`); failed++; }

for (const { label, publicPath, fnPath, required } of FILES) {
  console.log(`\n[${label}]`);
  if (!existsSync(publicPath)) {
    if (required) {
      fail(`missing required public file: ${publicPath}`);
    } else {
      console.log(`skip — ${publicPath} not present (optional)`);
    }
    continue;
  }
  let pubBuf, fnBuf;
  try { pubBuf = readFileSync(publicPath); }
  catch (err) { fail(`could not read ${publicPath}: ${err.message}`); continue; }
  try { fnBuf = readFileSync(fnPath); }
  catch (err) {
    fail(`could not read ${fnPath}: ${err.message}\n` +
         `Run: npm run sync:syllabus-data`);
    continue;
  }
  const pubHash = sha256(pubBuf);
  const fnHash = sha256(fnBuf);
  console.log(`  public:    ${statSync(publicPath).size} bytes  sha256=${pubHash.slice(0, 12)}`);
  console.log(`  functions: ${statSync(fnPath).size} bytes  sha256=${fnHash.slice(0, 12)}`);
  if (pubHash !== fnHash) {
    fail(`${label}: copies have drifted.\nRun: npm run sync:syllabus-data`);
  } else {
    console.log(`  ok  files are byte-identical`);
    passed += 1;
  }
}

console.log(`\n${failed === 0 ? `${passed} passed` : `${failed} failed`}\n`);
if (failed > 0) process.exit(1);
