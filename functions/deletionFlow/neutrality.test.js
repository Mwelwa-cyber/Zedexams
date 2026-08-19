"use strict";

/**
 * The deletion-flow `*Core.js` modules must load with ROOT dependencies only.
 *
 * ── The failure this exists to stop ────────────────────────────────────
 *
 * `Tests (Functions coverage)` and `Tests (importer + sanitize + schema)` both
 * run `npm ci` at the REPO ROOT and nowhere else, so `functions/node_modules`
 * does not exist when they execute. Anything they run that reaches
 * `firebase-functions` fails with MODULE_NOT_FOUND — and it fails in CI only,
 * because a developer's machine has those dependencies installed from the last
 * time they ran `cd functions && npm install`.
 *
 * That is exactly how it was caught here: `deletionSweeps.test.js` imported
 * `./index` for the sweep runners, passed locally, and took down two required
 * checks. The sweeps moved to their own `*Core.js` as a result — which is the
 * split CLAUDE.md already describes for `metaWhatsAppCore` and the rest, and
 * which this test now holds in place.
 *
 * ── Why the decision modules matter most ───────────────────────────────
 *
 * `deletionRequestCore` decides whether an account is waiting, scheduled or
 * gone; `deletionSweepCore` decides the ORDER of the writes that carry it out;
 * `decisionContextCore` decides what a guardian is told before they answer. If
 * any of them can only be exercised against a live Firestore, the thing nobody
 * checks until it is wrong in production is the thing that deletes children's
 * accounts.
 *
 * A SOURCE scan rather than an import-and-see: importing proves the module
 * loads in THIS environment, which is the one we already know works.
 *
 * Run: npm run test:deletion-neutrality
 */

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {join} = require("node:path");

const HERE = __dirname;

/** The modules that must stay loadable with root dependencies alone. */
const CORE_FILES = [
  "deletionRequestCore.js",
  "deletionSweepCore.js",
  "decisionContextCore.js",
];

/** And their tests, which are the reason the rule has teeth. */
const CORE_TESTS = [
  "deletionRequestCore.test.js",
  "deletionSweeps.test.js",
  "decisionContextCore.test.js",
];

const FORBIDDEN = [
  [
    /require\(\s*['"]firebase-functions/,
    "firebase-functions — it lives in functions/node_modules, which the " +
    "Functions-coverage job never installs",
  ],
  [
    /require\(\s*['"]firebase-admin/,
    "firebase-admin — same reason, and a core module that reaches the admin " +
    "SDK cannot be exercised without a live Firestore",
  ],
  [
    /require\(\s*['"]nodemailer/,
    "nodemailer — a decision module must not be able to send anything",
  ],
  [
    /require\(\s*['"]\.\/index/,
    "./index — that is the module which pulls firebase-functions in; reaching " +
    "it from a core file or its test is precisely the mistake this guard exists " +
    "to catch",
  ],
  [
    /require\(\s*['"][^'"]*\/src\//,
    "a module under src/ — src/ is not uploaded by `firebase deploy`, so the " +
    "import would resolve locally and fail in production",
  ],
];

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

for (const file of [...CORE_FILES, ...CORE_TESTS]) {
  test(`${file} loads with root dependencies alone`, () => {
    const src = readFileSync(join(HERE, file), "utf8");
    for (const [pattern, why] of FORBIDDEN) {
      const hit = src.match(pattern);
      assert.equal(
        hit, null,
        `${file} requires ${why}\n    found: ${hit && hit[0]}`,
      );
    }
  });
}

test("the core modules genuinely load under plain node", () => {
  // Belt to the source scan's braces: the scan cannot see a require that a
  // dependency of a dependency makes. These three have no dependencies beyond
  // each other, so loading them here proves it end to end.
  for (const file of CORE_FILES) {
    const mod = require(join(HERE, file));
    assert.ok(mod && typeof mod === "object", `${file} exported nothing`);
  }
});

test("index.js is allowed what the cores are not — it is the wiring", () => {
  // The inverse assertion, so this file cannot be mistaken for a ban on
  // firebase-functions in the feature. `index.js` holds the callables and the
  // secrets and SHOULD reach the SDK; it is simply never on a test's path.
  const src = readFileSync(join(HERE, "index.js"), "utf8");
  assert.match(
    src, /require\(\s*["']firebase-admin["']\)/,
    "index.js is the wiring layer and is expected to use the admin SDK",
  );
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}
console.log(`\ndeletion flow neutrality: ${tests.length - failed}/${tests.length} passed`);
if (failed) {
  throw new Error(`${failed} deletion-flow neutrality test(s) failed`);
}
