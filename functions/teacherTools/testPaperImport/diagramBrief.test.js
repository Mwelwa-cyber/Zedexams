/**
 * Unit tests for diagramBrief.js — the pure diagram-brief + library-reuse logic
 * for the Test Paper Studio photo import. Plain `node` assertions, no network.
 *
 * Run: node functions/teacherTools/testPaperImport/diagramBrief.test.js
 */

const assert = require("assert");
const {
  DIAGRAM_HANDLING_OPTIONS,
  HANDLING_IDS,
  normaliseDetected,
  buildDiagramPrompt,
  sizeForKind,
  buildLibraryQuery,
  scoreLibraryMatch,
  pickReusableDiagram,
  buildLibraryMetadata,
  tokenise,
} = require("./diagramBrief");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("diagramBrief");

// ─── Handling options ───────────────────────────────────────────────────────
test("exposes the five product handling options", () => {
  const ids = DIAGRAM_HANDLING_OPTIONS.map((o) => o.id);
  assert.deepStrictEqual(ids, [
    "keep_original", "clean_original", "redraw", "replace", "remove",
  ]);
  // Only redraw + replace generate.
  const generating = DIAGRAM_HANDLING_OPTIONS.filter((o) => o.needsGeneration).map((o) => o.id);
  assert.deepStrictEqual(generating, ["redraw", "replace"]);
  assert.ok(HANDLING_IDS.has("redraw") && !HANDLING_IDS.has("nonsense"));
});

// ─── normaliseDetected ──────────────────────────────────────────────────────
test("normaliseDetected tolerates strings, arrays and missing fields", () => {
  const d = normaliseDetected({
    kind: "  PLANT ",
    labels: "stem, roots\nleaves; flowers",
    caption: "Parts of a flowering plant",
  });
  assert.strictEqual(d.kind, "plant");
  assert.deepStrictEqual(d.labels, ["stem", "roots", "leaves", "flowers"]);
  assert.strictEqual(d.caption, "Parts of a flowering plant");
  // Empty input → safe defaults.
  const e = normaliseDetected();
  assert.strictEqual(e.kind, "other");
  assert.deepStrictEqual(e.labels, []);
});

test("normaliseDetected parses maths object groups", () => {
  const d = normaliseDetected({kind: "multiplication_groups", mathGroups: {groups: 2, perGroup: 3, item: "circle"}});
  assert.deepStrictEqual(d.mathGroups, {groups: 2, perGroup: 3, item: "circle"});
  // Invalid group counts → null.
  const bad = normaliseDetected({mathGroups: {groups: 0, perGroup: 3}});
  assert.strictEqual(bad.mathGroups, null);
});

// ─── buildDiagramPrompt ─────────────────────────────────────────────────────
test("buildDiagramPrompt enforces black-and-white printable rules", () => {
  const {prompt, style, size} = buildDiagramPrompt(
    {kind: "plant", caption: "A flowering plant", labels: ["stem", "roots", "leaves"]},
    {grade: "Grade 4"},
  );
  assert.strictEqual(style, "line_art");
  assert.strictEqual(size, "1024x1365"); // plant → portrait
  assert.match(prompt, /black-and-white line art/i);
  assert.match(prompt, /no colour/i);
  assert.match(prompt, /photocopying/i);
  // Label lines requested, but blank (text added by the studio overlay).
  assert.match(prompt, /leader\/label line/i);
  assert.match(prompt, /stem, roots, leaves/);
  assert.match(prompt, /Grade 4/);
});

test("buildDiagramPrompt draws maths object groups for multiplication", () => {
  const {prompt} = buildDiagramPrompt({
    kind: "multiplication_groups",
    caption: "3 x 2",
    mathGroups: {groups: 2, perGroup: 3, item: "circle"},
  });
  assert.match(prompt, /2 separate groups/);
  assert.match(prompt, /3 identical circles/);
});

test("buildDiagramPrompt builds a pictograph with rows + key", () => {
  const {prompt, size} = buildDiagramPrompt({
    kind: "pictograph",
    caption: "Fruits sold",
    data: [{label: "Mango", value: 4}, {label: "Banana", value: 2}],
  });
  assert.strictEqual(size, "1024x1024"); // pictograph not in landscape/portrait sets → square
  assert.match(prompt, /repeated identical symbol/i);
  assert.match(prompt, /key/i);
  assert.match(prompt, /Mango = 4; Banana = 2/);
});

test("sizeForKind picks orientation per kind", () => {
  assert.strictEqual(sizeForKind("bar_chart"), "1365x1024");
  assert.strictEqual(sizeForKind("body_part"), "1024x1365");
  assert.strictEqual(sizeForKind("shape"), "1024x1024");
});

// ─── Library query + scoring ────────────────────────────────────────────────
test("tokenise strips stopwords and short tokens", () => {
  assert.deepStrictEqual(tokenise("A labelled diagram of the human heart"), ["human", "heart"]);
});

test("buildLibraryQuery produces subject + keywords", () => {
  const q = buildLibraryQuery(
    {kind: "plant", caption: "Flowering plant", labels: ["stem", "roots"]},
    {subject: "Science", topic: "Plants"},
  );
  assert.strictEqual(q.subject, "science");
  assert.ok(q.keywords.includes("plant"));
  assert.ok(q.keywords.includes("stem"));
  assert.ok(q.keywords.includes("plants")); // from topic
});

test("scoreLibraryMatch rewards keyword overlap + subject match", () => {
  const query = {subject: "science", keywords: ["plant", "stem", "roots", "leaves"]};
  const good = scoreLibraryMatch(
    {name: "Flowering plant", subject: "science", keywords: ["plant", "stem", "roots", "leaves"]},
    query,
  );
  const wrong = scoreLibraryMatch(
    {name: "Bar chart", subject: "mathematics", keywords: ["bar", "chart"]},
    query,
  );
  assert.ok(good > 0.9, `expected strong match, got ${good}`);
  assert.ok(wrong < 0.2, `expected weak match, got ${wrong}`);
  // No keywords to match → 0.
  assert.strictEqual(scoreLibraryMatch({name: "x"}, {keywords: []}), 0);
});

test("pickReusableDiagram reuses a strong match, skips weak ones", () => {
  const query = {subject: "science", keywords: ["plant", "stem", "roots", "leaves"]};
  const candidates = [
    {id: "a", url: "u-a", name: "Bar chart", subject: "mathematics", keywords: ["bar"]},
    {id: "b", url: "u-b", name: "Flowering plant", subject: "science", keywords: ["plant", "stem", "roots", "leaves"]},
    {id: "c", name: "No url plant", subject: "science", keywords: ["plant", "stem"]}, // no url → ignored
  ];
  const match = pickReusableDiagram(candidates, query);
  assert.ok(match);
  assert.strictEqual(match.picture.id, "b");

  // Nothing clears the bar → null.
  const none = pickReusableDiagram(
    [{id: "x", url: "u", name: "Map of Zambia", subject: "social", keywords: ["map", "zambia"]}],
    query,
  );
  assert.strictEqual(none, null);
});

// ─── Library metadata ───────────────────────────────────────────────────────
test("buildLibraryMetadata produces a staged pictureBank doc", () => {
  const meta = buildLibraryMetadata(
    {kind: "plant", caption: "Flowering plant", labels: ["stem", "roots"]},
    {subject: "Science", grade: "Grade 4", topic: "Plants"},
    {url: "https://example/x.png", prompt: "draw a plant"},
  );
  assert.strictEqual(meta.status, "staged");
  assert.strictEqual(meta.source, "test_paper_import");
  assert.strictEqual(meta.subject, "science");
  assert.strictEqual(meta.diagramType, "plant");
  assert.strictEqual(meta.name, "Flowering plant");
  assert.strictEqual(meta.url, "https://example/x.png");
  assert.ok(Array.isArray(meta.keywords) && meta.keywords.length > 0);
});

console.log(`\ndiagramBrief: ${passed} passed\n`);
