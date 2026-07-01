/**
 * Regression guard for the Firebase-deploy outage of 2026-07-01.
 *
 * A Cloud Function that declares a secret via `defineSecret(...)` AND binds it
 * (passes it into a function's `secrets: [...]` list) makes that secret
 * REQUIRED at deploy time. In `--non-interactive` mode `firebase deploy` then
 * hard-fails with:
 *
 *     Error: In non-interactive mode but have no value for the secret: <NAME>
 *
 * if the secret is not present in the project. That is exactly what broke every
 * Firebase deploy once the (unfunded, decommissioned) RECRAFT_API_KEY was pruned
 * from the project while three functions still bound it.
 *
 * The invariant this test locks in: a provider that is DISABLED in code
 * (RECRAFT_ENABLED / KIE_ENABLED === false) must NOT have its secret bound. If
 * you re-enable a provider, set its secret in the project first, flip the
 * *_ENABLED flag to true, and only then re-introduce the binding — this test
 * will remind you.
 *
 * Run: node functions/deadProviderSecrets.test.js
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("dead-provider secrets");

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");

const indexSrc = read("index.js");
const diagramSrc = read("teacherTools/generateDiagram.js");

// Read the provider enable flags straight from the source of truth.
function flag(name) {
  const m = diagramSrc.match(new RegExp(`${name}\\s*=\\s*(true|false)`));
  assert.ok(m, `${name} flag found in generateDiagram.js`);
  return m[1] === "true";
}
const recraftEnabled = flag("RECRAFT_ENABLED");
const kieEnabled = flag("KIE_ENABLED");

// A secret is "bound" only if it is declared with defineSecret(...). Without a
// defineSecret it cannot be added to any function's `secrets: [...]`, so the
// deploy can never require it.
function isDeclared(secretName) {
  return new RegExp(`defineSecret\\(["']${secretName}["']\\)`).test(indexSrc);
}

// Recraft (decommissioned 2026-06) must not be bound while disabled.
ok("RECRAFT_ENABLED is false (still decommissioned)", recraftEnabled === false);
ok("RECRAFT_API_KEY is not declared/bound while Recraft is disabled",
  !isDeclared("RECRAFT_API_KEY"));

// Kie (decommissioned 2026-06) must not be bound while disabled.
ok("KIE_ENABLED is false (still decommissioned)", kieEnabled === false);
ok("KIE_API_KEY is not declared/bound while Kie is disabled",
  !isDeclared("KIE_API_KEY"));

// The two factories that previously bound the Recraft secret unconditionally
// must build their `secrets` list conditionally, so passing null skips it.
const redrawSrc = read("teacherTools/testPaperImport/redrawTestPaperDiagram.js");
for (const [label, src] of [
  ["generateDiagram.js", diagramSrc],
  ["redrawTestPaperDiagram.js", redrawSrc],
]) {
  ok(`${label} does not unconditionally bind the recraft secret`,
    !/const\s+secrets\s*=\s*\[\s*recraftApiKeySecret\s*\]/.test(src));
}

console.log(`\n${passed} assertions passed`);
