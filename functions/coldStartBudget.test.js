/**
 * Cold-start budget guard.
 * Run: node functions/coldStartBudget.test.js
 *
 * Every Cloud Function instance loads the WHOLE of functions/index.js before it
 * serves its first request — all 196 exports share one module graph. So a
 * top-level `require` of a heavy package in any module reachable from index.js
 * is paid by every callable, trigger and cron in the codebase, including the
 * ones that will never call it.
 *
 * That is not a theoretical cost. Memory kills and timeouts on cold-starting
 * instances were the whole of the #2230 outage, and the platform kills the
 * container without running any error handler — so the failure arrives as a
 * 503 with no stack trace attached (see the `functionErrorWatch` notes in
 * CLAUDE.md).
 *
 * This test asserts the specific heavy packages stay OFF the startup path by
 * checking `require.cache` after loading index.js. It is deliberately a cache
 * assertion rather than a wall-clock or RSS budget: timing and memory numbers
 * vary with the machine and would make CI flaky, while "was this module loaded"
 * is exact and reproducible everywhere.
 *
 * Adding a package here is a decision to keep it lazy. If a future change
 * genuinely needs one of these at startup, delete its entry and say why in the
 * PR — don't weaken the check into a warning.
 */

const assert = require("node:assert");
const path = require("node:path");

// index.js reads these at load; supply them so the require doesn't fail.
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "examsprepzambia";
process.env.FIREBASE_CONFIG = process.env.FIREBASE_CONFIG || JSON.stringify({
  projectId: "examsprepzambia",
  storageBucket: "examsprepzambia.firebasestorage.app",
});

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("coldStartBudget");

// Packages that must NOT load at startup, with the surface that legitimately
// uses each one and the cost measured when it was moved off the startup path.
const MUST_STAY_LAZY = [
  ["@google-cloud/text-to-speech", "apiTextToSpeech only", "37.5 MiB / 181 ms"],
  ["exceljs", "parseSyllabusUpload storage trigger only", "27.5 MiB / 160 ms"],
  ["mammoth", "past-paper .docx import only", "18.2 MiB / 78 ms"],
  ["@simplewebauthn/server", "the four passkey callables only", "17.7 MiB / 114 ms"],
  ["nodemailer", "the email senders only", "17.8 MiB / 47 ms"],
];

const before = process.memoryUsage().rss;
const started = Date.now();
require("./index.js");
const loadMs = Date.now() - started;
const rssMib = (process.memoryUsage().rss - before) / 1024 / 1024;

// A package counts as loaded if any file under its node_modules directory is
// in the require cache. Matching on the directory rather than the entry file
// catches a deep require like `mammoth/lib/index.js` too.
function isLoaded(pkg) {
  const needle = path.join("node_modules", ...pkg.split("/")) + path.sep;
  return Object.keys(require.cache).some((f) => f.includes(needle));
}

for (const [pkg, usedBy, cost] of MUST_STAY_LAZY) {
  ok(`${pkg} is not loaded at startup (${usedBy}; ${cost})`, !isLoaded(pkg));
}

// The export surface must be unchanged by any lazy-loading work: a `require`
// moved into the wrong scope can throw at load and silently drop exports, and
// a missing export is a deleted production endpoint.
const exported = Object.keys(require("./index.js"));
ok(`index.js still exports the full surface (${exported.length} exports)`,
    exported.length >= 196);

console.log(`\n  (informational: ${loadMs} ms load, ${rssMib.toFixed(1)} MiB RSS ` +
  `on this machine — not asserted, machine-dependent)`);
console.log(`\n─── ${passed} assertions · all passed ───`);
