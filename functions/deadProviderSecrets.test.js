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
 * The invariant this test locks in: a provider that has been decommissioned in
 * code (Recraft 2026-06, Kie 2026-07 — both fully removed, every image request
 * now served by gpt-image-1) must NOT have its secret declared/bound. If you
 * re-enable a provider, set its secret in the project first, restore the
 * provider branch, and only then re-introduce the binding — this test will
 * remind you.
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

// A secret is "bound" only if it is declared with defineSecret(...). Without a
// defineSecret it cannot be added to any function's `secrets: [...]`, so the
// deploy can never require it.
function isDeclared(secretName) {
  return new RegExp(`defineSecret\\(["']${secretName}["']\\)`).test(indexSrc);
}

// Recraft (decommissioned 2026-06) must not be declared/bound.
ok("RECRAFT_API_KEY is not declared/bound (Recraft decommissioned)",
  !isDeclared("RECRAFT_API_KEY"));

// Kie (decommissioned 2026-07) must not be declared/bound.
ok("KIE_API_KEY is not declared/bound (Kie decommissioned)",
  !isDeclared("KIE_API_KEY"));

// The image factories must not accept or bind a Recraft/Kie secret at all — the
// dead providers were removed, so re-introducing a `*ApiKeySecret` parameter is
// how a bound-but-unset secret would sneak back and break the deploy again.
const diagramSrc = read("teacherTools/generateDiagram.js");
const redrawSrc = read("teacherTools/testPaperImport/redrawTestPaperDiagram.js");
const slideNotesSrc = read("teacherTools/generateSlideNotes.js");
for (const [label, src] of [
  ["generateDiagram.js", diagramSrc],
  ["redrawTestPaperDiagram.js", redrawSrc],
  ["generateSlideNotes.js", slideNotesSrc],
]) {
  // A bare RECRAFT_API_KEY mention in a "how to re-enable" comment is harmless;
  // the deploy-breaking patterns are a bound secret parameter or a runtime read.
  ok(`${label} does not bind or read a recraft secret`,
    !/recraftApiKeySecret/.test(src) && !/process\.env\.RECRAFT_API_KEY/.test(src));
  ok(`${label} does not bind or read a kie secret`,
    !/kieApiKeySecret/.test(src) && !/process\.env\.KIE_API_KEY/.test(src));
}

console.log(`\n${passed} assertions passed`);
