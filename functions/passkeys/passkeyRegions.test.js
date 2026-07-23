/**
 * Node test for functions/passkeys/passkeyRegions.js — the region registry
 * behind the staged us-central1 → africa-south1 passkey migration — plus
 * text-level parity checks against functions/index.js (same convention as
 * scripts/test-firestore-rules-text.mjs: the wrappers can't be require()d
 * without the whole firebase-functions runtime, but the invariants that keep
 * the two regions equivalent are all visible in the source).
 *
 * Run: node functions/passkeys/passkeyRegions.test.js
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const regions = require("./passkeyRegions");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

// ── Registry invariants ────────────────────────────────────────────────────
ok("primary region is us-central1", regions.PASSKEY_PRIMARY_REGION === "us-central1");
ok("regional region is africa-south1 (Firestore colocation)",
    regions.PASSKEY_REGIONAL_REGION === "africa-south1");
ok("runtime options match the originals (30s / 256MiB)",
    regions.PASSKEY_CALLABLE_RUNTIME.timeoutSeconds === 30 &&
    regions.PASSKEY_CALLABLE_RUNTIME.memory === "256MiB");

const FLOW = [
  "generatePasskeyRegistrationOptions",
  "verifyPasskeyRegistration",
  "generatePasskeyAuthenticationOptions",
  "verifyPasskeyAuthentication",
];
const MANAGEMENT = ["listUserPasskeys", "renameUserPasskey", "removeUserPasskey"];

ok("exactly the four flow callables get a regional twin",
    JSON.stringify([...regions.PASSKEY_REGIONAL_CALLABLES].sort()) ===
    JSON.stringify([...FLOW].sort()));
ok("exactly the three management callables stay primary-only",
    JSON.stringify([...regions.PASSKEY_PRIMARY_ONLY_CALLABLES].sort()) ===
    JSON.stringify([...MANAGEMENT].sort()));
ok("no callable is in both lists",
    regions.PASSKEY_REGIONAL_CALLABLES.every(
        (n) => !regions.PASSKEY_PRIMARY_ONLY_CALLABLES.includes(n)));
ok("regional and primary-only lists cover all seven passkey callables",
    regions.PASSKEY_REGIONAL_CALLABLES.length +
    regions.PASSKEY_PRIMARY_ONLY_CALLABLES.length === 7);

for (const base of regions.PASSKEY_REGIONAL_CALLABLES) {
  const name = regions.regionalExportName(base);
  ok(`${name} is the twin export name for ${base}`, name === `${base}Africa`);
  // Cloud Functions gen-2 resource ids come from the lowercased export name;
  // stay comfortably under the 63-char limit.
  ok(`${name} fits the Cloud Functions name limit`, name.length <= 63);
}

// ── functions/index.js parity (source text) ────────────────────────────────
const indexSrc = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

// The original seven us-central1 exports must all still exist untouched —
// the migration is additive, never a replacement.
for (const base of [...FLOW, ...MANAGEMENT]) {
  const re = new RegExp(
      `exports\\.${base} = onCall\\(\\{\\s*region: "us-central1"`, "m");
  ok(`original us-central1 export ${base} is still deployed`, re.test(indexSrc));
}

// Each flow callable has a regional twin built through passkeyRegionalCallable
// with the BASE name (so App Check enforcement + telemetry keys are identical
// across regions) and the shared handler.
const HANDLER = {
  generatePasskeyRegistrationOptions: "runGeneratePasskeyRegistrationOptions",
  verifyPasskeyRegistration: "runVerifyPasskeyRegistration",
  generatePasskeyAuthenticationOptions: "runGeneratePasskeyAuthenticationOptions",
  verifyPasskeyAuthentication: "runVerifyPasskeyAuthentication",
};
for (const base of FLOW) {
  const twin = regions.regionalExportName(base);
  const re = new RegExp(
      `exports\\.${twin} = passkeyRegionalCallable\\(\\s*"${base}", ${HANDLER[base]}\\)`, "m");
  ok(`${twin} wraps the SAME handler under the SAME App Check label`, re.test(indexSrc));
}

// Management callables must NOT have regional twins.
for (const base of MANAGEMENT) {
  ok(`${base} has no regional twin`,
      !indexSrc.includes(`exports.${regions.regionalExportName(base)}`));
}

// The shared twin factory pins region + runtime from the registry and keeps
// App Check enforcement keyed on the base name.
ok("twin factory uses the registry region",
    /region: PASSKEY_REGIONAL_REGION,\s*\.\.\.PASSKEY_CALLABLE_RUNTIME/.test(indexSrc));
ok("twin factory keeps App Check enforcement on the base name",
    /enforceAppCheck: shouldEnforceAppCheck\(baseName\)/.test(indexSrc));
ok("twin factory records App Check telemetry under the base name",
    /recordAppCheckCallable\(request, baseName\)/.test(indexSrc));

// ── Client mirror (source text — the runnable mirror check lives in
//    scripts/test-passkey-region-routing.mjs, which imports both modules) ──
const clientSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "services", "passkeyRegionCore.js"), "utf8");
ok("client core mirrors the primary region",
    clientSrc.includes(`PASSKEY_PRIMARY_REGION = '${regions.PASSKEY_PRIMARY_REGION}'`));
ok("client core mirrors the regional region",
    clientSrc.includes(`PASSKEY_REGIONAL_REGION = '${regions.PASSKEY_REGIONAL_REGION}'`));
ok("client core mirrors the twin suffix",
    clientSrc.includes(`PASSKEY_REGIONAL_SUFFIX = '${regions.PASSKEY_REGIONAL_SUFFIX}'`));

console.log(`\npasskeyRegions: ${passed} tests passed`);
