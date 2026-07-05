"use strict";

/**
 * Unit tests for the App Check enforcement resolver. Plain `node` assertion
 * script (run via `npm run test:appcheck-enforce`, picked up by test:all).
 */

const assert = require("node:assert");
const { resolveAppCheckEnforcement, parseLabels } = require("./appCheckEnforcement");

let pass = 0;
function test(name, fn) {
  fn();
  pass++;
  console.log(`  ok  ${name}`);
}

test("default (no env) enforces nothing — observe-only", () => {
  const r = resolveAppCheckEnforcement({});
  assert.strictEqual(r.global, false);
  assert.strictEqual(r.enforces("aiChat"), false);
  assert.strictEqual(r.enforces("generateQuizQuestions"), false);
});

test("APPCHECK_ENFORCE=1 enforces every label (global, back-compat)", () => {
  const r = resolveAppCheckEnforcement({ APPCHECK_ENFORCE: "1" });
  assert.strictEqual(r.global, true);
  assert.strictEqual(r.enforces("aiChat"), true);
  assert.strictEqual(r.enforces("anythingAtAll"), true);
});

test("APPCHECK_ENFORCE only counts the exact string '1'", () => {
  for (const v of ["0", "", "true", "yes", "01", " 1"]) {
    const r = resolveAppCheckEnforcement({ APPCHECK_ENFORCE: v });
    assert.strictEqual(r.global, false, `APPCHECK_ENFORCE=${JSON.stringify(v)} must not enable global`);
    assert.strictEqual(r.enforces("aiChat"), false);
  }
});

test("APPCHECK_ENFORCE_LABELS enforces only the listed endpoints (canary)", () => {
  const r = resolveAppCheckEnforcement({
    APPCHECK_ENFORCE_LABELS: "generateQuizQuestions,ocrNotePages",
  });
  assert.strictEqual(r.global, false);
  assert.strictEqual(r.enforces("generateQuizQuestions"), true);
  assert.strictEqual(r.enforces("ocrNotePages"), true);
  assert.strictEqual(r.enforces("aiChat"), false);
});

test("label list tolerates spaces, newlines, and trailing separators", () => {
  const r = resolveAppCheckEnforcement({
    APPCHECK_ENFORCE_LABELS: " aiChat ,\n  explainAnswer,,\t",
  });
  assert.deepStrictEqual([...r.labels].sort(), ["aiChat", "explainAnswer"]);
  assert.strictEqual(r.enforces("aiChat"), true);
  assert.strictEqual(r.enforces("explainAnswer"), true);
  assert.strictEqual(r.enforces("ocrNotePages"), false);
});

test("global switch wins over the label list", () => {
  const r = resolveAppCheckEnforcement({
    APPCHECK_ENFORCE: "1",
    APPCHECK_ENFORCE_LABELS: "aiChat",
  });
  assert.strictEqual(r.enforces("verifyGooglePlayPurchase"), true);
});

test("parseLabels handles empty / non-string input", () => {
  assert.strictEqual(parseLabels(undefined).size, 0);
  assert.strictEqual(parseLabels("").size, 0);
  assert.strictEqual(parseLabels(null).size, 0);
  assert.strictEqual(parseLabels(42).size, 0);
});

console.log(`\n─── ${pass} assertions · all passed ───`);
