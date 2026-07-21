/**
 * Unit tests for functions/agents/runners/optionDedupeKey.js
 *
 * Guards the fix for the false "duplicate options" reports Vigil filed against
 * the Grade 7 English Language Mock (quiz q2WGapKWzsxvTklaw7mG): a
 * capitalisation / underline question's options read differently but the old
 * `extractPlainText(o).trim().toLowerCase()` key flattened + lowercased them
 * into a collision. optionDedupeKey preserves case and formatting marks so only
 * genuinely identical options collide, while still flattening rich-text docs.
 */

import assert from "node:assert";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);
const {optionDedupeKey} = require("../functions/agents/runners/optionDedupeKey.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const doc = (nodes) => ({type: "doc", content: [{type: "paragraph", content: nodes}]});
const textNode = (text, marks) => (marks ? {type: "text", text, marks} : {type: "text", text});
const richText = (label) => doc([textNode(label)]);
const same = (a, b) => optionDedupeKey(a) === optionDedupeKey(b);

// ── the reported bug: case-only differences must NOT collide ──────────────

test("plain options differing only in case are DISTINCT", () => {
  assert.ok(!same("My name is John", "my name is john"));
  assert.ok(!same("Lusaka", "lusaka"));
});

test("capitalisation-question options (rich text) are DISTINCT", () => {
  const keys = [
    "my friend lives in lusaka.",
    "My friend lives in Lusaka.",
    "My Friend lives in lusaka.",
    "my friend lives in Lusaka.",
  ].map((s) => optionDedupeKey(richText(s)));
  assert.strictEqual(new Set(keys).size, keys.length, "all four should be unique");
});

test("options differing only in a formatting mark (underline) are DISTINCT", () => {
  const underlined = doc([textNode("the dog "), textNode("ran", [{type: "underline"}])]);
  const plain = richText("the dog ran");
  assert.ok(!same(underlined, plain));
});

test("options differing only in bold are DISTINCT", () => {
  const bold = doc([textNode("Paris", [{type: "bold"}])]);
  const plain = richText("Paris");
  assert.ok(!same(bold, plain));
});

// ── genuine duplicates must STILL collide ─────────────────────────────────

test("identical plain options collide", () => {
  assert.ok(same("Lusaka", "Lusaka"));
});

test("identical rich-text options collide", () => {
  assert.ok(same(richText("make them look more attractive."), richText("make them look more attractive.")));
});

test("a plain string and an equivalent rich-text doc collide", () => {
  assert.ok(same("Lusaka", richText("Lusaka")));
});

test("same visible text split across text nodes still collides (whitespace/tokenisation)", () => {
  const split = doc([textNode("the dog "), textNode("ran")]);
  const single = richText("the dog ran");
  assert.ok(same(split, single));
});

test("identical options carrying the identical mark collide", () => {
  const a = doc([textNode("ran", [{type: "underline"}])]);
  const b = doc([textNode("ran", [{type: "underline"}])]);
  assert.ok(same(a, b));
});

// ── distinct content stays distinct ───────────────────────────────────────

test("genuinely different options do NOT collide", () => {
  assert.ok(!same(richText("make them look more attractive."), richText("make them look very expensive.")));
});

test("distinct maths fraction options do NOT collide, identical ones do", () => {
  const half = doc([{type: "mathFraction", attrs: {num: "1", den: "2"}}]);
  const third = doc([{type: "mathFraction", attrs: {num: "1", den: "3"}}]);
  const half2 = doc([{type: "mathFraction", attrs: {num: "1", den: "2"}}]);
  assert.ok(!same(half, third));
  assert.ok(same(half, half2));
});

// ── empty options resolve to "" so they are never "duplicates" ────────────

test("empty / whitespace-only options resolve to an empty key", () => {
  assert.strictEqual(optionDedupeKey(""), "");
  assert.strictEqual(optionDedupeKey("   "), "");
  assert.strictEqual(optionDedupeKey(null), "");
  assert.strictEqual(optionDedupeKey(undefined), "");
  const emptyDoc = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"attrs\":{\"textAlign\":null}}]}";
  assert.strictEqual(optionDedupeKey(emptyDoc), "");
});

console.log(`\noptionDedupeKey: ${passed} tests passed`);
