/**
 * Unit tests for the server copy of the syllabus topic hierarchy.
 * Plain Node assertions, no test runner (repo convention). Pure module —
 * no Firebase, no network.
 *
 * Complements scripts/test-syllabus-topic-tree.mjs (which pins the ESM/CJS
 * copies to identical output over shared fixtures) — this file exercises the
 * server copy directly so the backend coverage gate sees it.
 *
 *   node functions/teacherTools/syllabusTopicTree.test.js
 */

const assert = require("node:assert");
const {
  parseTopicCode,
  looksLikeTopicFragment,
  normalizeTopicTree,
  normalizeTopicLookup,
} = require("./syllabusTopicTree");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

// ── parseTopicCode ───────────────────────────────────────────────────
test("parses a dotted code + title", () => {
  const p = parseTopicCode("7.4.3 Fruits and seeds");
  assert.strictEqual(p.code, "7.4.3");
  assert.deepStrictEqual(p.segments, [7, 4, 3]);
  assert.strictEqual(p.title, "Fruits and seeds");
  assert.strictEqual(p.key, "7.4.3");
  assert.strictEqual(p.parentKey, "7.4");
});

test("repairs OCR-spaced codes and trailing punctuation", () => {
  const p = parseTopicCode(" 7 . 4 . 3. Fruits");
  assert.strictEqual(p.code, "7.4.3");
  assert.strictEqual(p.title, "Fruits");
});

test("trailing zeros are stripped from the key but kept in the code", () => {
  const p = parseTopicCode("7.4.0 Plants");
  assert.strictEqual(p.code, "7.4.0");
  assert.strictEqual(p.key, "7.4");
  assert.strictEqual(p.parentKey, "7");
});

test("a bare code with no title parses; no code returns null", () => {
  assert.strictEqual(parseTopicCode("7.4)").code, "7.4");
  assert.strictEqual(parseTopicCode("Plain heading"), null);
  assert.strictEqual(parseTopicCode(""), null);
  assert.strictEqual(parseTopicCode(null), null);
});

// ── looksLikeTopicFragment ───────────────────────────────────────────
test("lower-case openers and embedded outcome refs are fragments", () => {
  assert.strictEqual(looksLikeTopicFragment("identify sounds in words"), true);
  assert.strictEqual(looksLikeTopicFragment("as in outcome 1.2.3 above"), true);
  assert.strictEqual(looksLikeTopicFragment(""), true);
});

test("numbered topics and upper-case headings are not fragments", () => {
  assert.strictEqual(looksLikeTopicFragment("7.4 PLANTS"), false);
  assert.strictEqual(looksLikeTopicFragment("PHONICS"), false);
  // Real Form 3-4 heading whose code doesn't parse must survive.
  assert.strictEqual(looksLikeTopicFragment("3-4.1.1. SELECTED PRESCRIBED TEXT"), false);
});

// ── normalizeTopicTree ───────────────────────────────────────────────
test("a numbered child topic is demoted under its parent", () => {
  const {topics, demoted} = normalizeTopicTree(new Map([
    ["7.4 PLANTS", ["7.4.1 Roots"]],
    ["7.4.3 Fruits and seeds", ["7.4.3.1 Dispersal"]],
    ["7.5 ANIMALS", []],
  ]));
  assert.deepStrictEqual([...topics.keys()], ["7.4 PLANTS", "7.5 ANIMALS"]);
  assert.deepStrictEqual([...topics.get("7.4 PLANTS")].sort(), [
    "7.4.1 Roots", "7.4.3 Fruits and seeds", "7.4.3.1 Dispersal",
  ].sort());
  assert.deepStrictEqual(demoted, [{topic: "7.4.3 Fruits and seeds", parent: "7.4 PLANTS"}]);
});

test("in a mostly-numbered scope, an un-numbered fragment folds into the previous topic", () => {
  const {topics, folded} = normalizeTopicTree(new Map([
    ["7.4 PLANTS", ["Roots"]],
    ["7.5 ANIMALS", []],
    ["7.6 SOIL", []],
    ["and seed dispersal", ["Wind"]],
  ]));
  assert.strictEqual(topics.has("and seed dispersal"), false);
  assert.strictEqual(folded.length, 1);
  assert.strictEqual(folded[0].parent, "7.6 SOIL");
  assert.ok(topics.get("7.6 SOIL").has("Wind"));
});

test("in a mostly-unnumbered scope, headings are never folded away", () => {
  const {topics} = normalizeTopicTree(new Map([
    ["PHONICS", ["Sounds"]],
    ["rhymes and songs", []],
    ["STORY TELLING", []],
  ]));
  // Only 0/3 entries numbered → below the folding share; everything kept.
  assert.strictEqual(topics.size, 3);
});

test("a duplicated parent code makes the child ambiguous, not misfiled", () => {
  const {topics, ambiguous} = normalizeTopicTree(new Map([
    ["1.2 READING", []],
    ["1.2 WRITING", []],
    ["1.2.1 Letters", []],
  ]));
  // Two owners of key 1.2 → the child cannot pick a parent silently.
  assert.strictEqual(ambiguous.length, 1);
  assert.deepStrictEqual(ambiguous[0].owners.sort(), ["1.2 READING", "1.2 WRITING"]);
  assert.ok(topics.has("1.2.1 Letters") || [...topics.values()].some((s) => s.has("1.2.1 Letters")));
});

test("empty and plain-object inputs are accepted", () => {
  assert.strictEqual(normalizeTopicTree(new Map()).topics.size, 0);
  const fromObj = normalizeTopicTree({"7.1 SETS": ["7.1.1 Members"]});
  assert.ok(fromObj.topics.has("7.1 SETS"));
});

// ── normalizeTopicLookup ─────────────────────────────────────────────
test("normalizeTopicLookup maps every grade|subject scope independently", () => {
  const out = normalizeTopicLookup(new Map([
    ["G7|science", new Map([["7.4 PLANTS", []], ["7.4.3 Fruits", []]])],
    ["G8|science", new Map([["8.1 CELLS", []]])],
  ]));
  assert.deepStrictEqual([...out.get("G7|science").keys()], ["7.4 PLANTS"]);
  assert.deepStrictEqual([...out.get("G8|science").keys()], ["8.1 CELLS"]);
  assert.strictEqual(normalizeTopicLookup(null).size, 0);
});

console.log(`\nsyllabusTopicTree: all ${passed} tests passed`);
