/**
 * Tests for layoutPass — routing + the optional cheap layout classifier.
 * Plain `node` script; throws on the first failed assertion.
 *
 * Run: node functions/teacherTools/testPaperImport/layoutPass.test.js
 */

const assert = require("node:assert");
const {
  ROUTES,
  routeDiagram,
  routeObject,
  normaliseLayout,
  summariseLayout,
  normBox,
  runLayoutPass,
  LAYOUT_TOOL_SCHEMA,
} = require("./layoutPass");

let passed = 0;
const tests = [];
function test(name, fn) {
  tests.push({name, fn});
}

console.log("layoutPass");

// ── routeDiagram ─────────────────────────────────────────────────────────────
test("a table figure routes to a table rebuild", () => {
  const r = routeDiagram({kind: "table", confidence: 0.9});
  assert.equal(r.route, ROUTES.RECONSTRUCT);
  assert.equal(r.rebuild, "table");
});

test("a pictograph routes to a table rebuild", () => {
  assert.equal(routeDiagram({kind: "pictograph", confidence: 0.9}).rebuild, "table");
});

test("a bar chart routes to a graph rebuild", () => {
  const r = routeDiagram({kind: "bar_chart", confidence: 0.9});
  assert.equal(r.route, ROUTES.RECONSTRUCT);
  assert.equal(r.rebuild, "graph");
});

test("a science diagram routes to a diagram rebuild", () => {
  const r = routeDiagram({kind: "labelled_science", confidence: 0.9});
  assert.equal(r.route, ROUTES.RECONSTRUCT);
  assert.equal(r.rebuild, "diagram");
});

test("a low-confidence figure goes to review, never auto-reconstructed", () => {
  const r = routeDiagram({kind: "table", confidence: 0.3});
  assert.equal(r.route, ROUTES.REVIEW);
  assert.equal(r.rebuild, null);
});

test("an unclassified figure goes to review", () => {
  assert.equal(routeDiagram({kind: "other", confidence: 0.9}).route, ROUTES.REVIEW);
});

// ── routeObject ──────────────────────────────────────────────────────────────
test("plain text objects ride the cheap pass", () => {
  assert.equal(routeObject({type: "question", confidence: 0.9}).route, ROUTES.CHEAP);
  assert.equal(routeObject({type: "instruction", confidence: 0.9}).route, ROUTES.CHEAP);
});

test("structured data objects escalate to reconstruction", () => {
  assert.equal(routeObject({type: "table", confidence: 0.9}).route, ROUTES.RECONSTRUCT);
  assert.equal(routeObject({type: "graph", confidence: 0.9}).route, ROUTES.RECONSTRUCT);
});

test("math objects go to review (careful read, no image-gen)", () => {
  assert.equal(routeObject({type: "math", confidence: 0.9}).route, ROUTES.REVIEW);
});

// ── normaliseLayout ──────────────────────────────────────────────────────────
test("drops unknown types and clamps confidence + boxes", () => {
  const layout = normaliseLayout({
    objects: [
      {type: "table", confidence: 1.4, box: {x: 0.1, y: 0.1, w: 0.5, h: 0.4}},
      {type: "bogus", confidence: 0.9},
      {type: "question", confidence: "not a number", box: {x: -1, y: 0, w: 0, h: 0}},
    ],
  });
  assert.equal(layout.objects.length, 2);
  assert.equal(layout.objects[0].confidence, 1); // clamped
  assert.ok(layout.objects[0].box); // valid box kept
  assert.equal(layout.objects[0].route, ROUTES.RECONSTRUCT);
  assert.equal(layout.objects[1].confidence, null); // non-numeric → null
  assert.equal(layout.objects[1].box, null); // degenerate box dropped
});

test("normBox rejects a zero-area box", () => {
  assert.equal(normBox({x: 0.1, y: 0.1, w: 0, h: 0.2}), null);
  assert.ok(normBox({x: 0.1, y: 0.1, w: 0.2, h: 0.2}));
});

// ── summariseLayout ──────────────────────────────────────────────────────────
test("summarises counts + routing tallies", () => {
  const layout = normaliseLayout({
    objects: [
      {type: "question", confidence: 0.9},
      {type: "question", confidence: 0.9},
      {type: "table", confidence: 0.9},
      {type: "pictograph", confidence: 0.9},
      {type: "math", confidence: 0.9},
    ],
  });
  const s = summariseLayout(layout);
  assert.equal(s.total, 5);
  assert.equal(s.questions, 2);
  assert.equal(s.tables, 2);
  assert.equal(s.reconstruct, 2); // table + pictograph
  assert.equal(s.review, 1); // math
});

// ── runLayoutPass (injected model) ───────────────────────────────────────────
test("runLayoutPass returns a normalised inventory from the injected model", async () => {
  const res = await runLayoutPass(
    {image: {data: "abc", mediaType: "image/png"}},
    {classify: async () => ({objects: [{type: "table", confidence: 0.9}]})},
  );
  assert.equal(res.objects.length, 1);
  assert.equal(res.summary.tables, 1);
});

test("runLayoutPass degrades to an empty inventory on model failure", async () => {
  const res = await runLayoutPass(
    {image: {data: "abc", mediaType: "image/png"}},
    {classify: async () => { throw new Error("model down"); }},
  );
  assert.equal(res.objects.length, 0);
  assert.equal(res.degraded, true);
});

test("runLayoutPass throws with no image", async () => {
  await assert.rejects(() => runLayoutPass({}, {classify: async () => ({})}));
});

test("the tool schema requires an objects array", () => {
  assert.deepEqual(LAYOUT_TOOL_SCHEMA.required, ["objects"]);
});

(async () => {
  for (const {name, fn} of tests) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  }
  console.log(`\nlayoutPass: ${passed} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
