/**
 * Unit tests for rebuildTable — the "Rebuild as table" import helper.
 * Plain `node` script (throws on assertion failure). The model call + image
 * fetch are injected, so nothing here touches the network.
 *
 * Run: node functions/teacherTools/testPaperImport/rebuildTable.test.js
 */

const assert = require("node:assert");
const {
  normaliseTableData,
  hasTableContent,
  runRebuildTable,
} = require("./rebuildTable");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
async function asyncTest(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("rebuildTable");

async function main() {
// ── normaliseTableData ──────────────────────────────────────────────────────
test("squares off ragged rows to the header column count", () => {
  const t = normaliseTableData({
    headers: ["Fruit", "People"],
    rows: [["orange", "3"], ["mango"], ["banana", "1", "extra-ignored"]],
  });
  assert.deepStrictEqual(t.headers, ["Fruit", "People"]);
  assert.deepStrictEqual(t.rows, [
    ["orange", "3"],
    ["mango", ""],
    ["banana", "1"],
  ]);
});

test("caps columns at 6 and rows at 12, trims long cells", () => {
  const wide = Array.from({length: 9}, (_, i) => `h${i}`);
  const longCell = "x".repeat(80);
  const t = normaliseTableData({
    headers: wide,
    rows: Array.from({length: 20}, () => [longCell, ...wide]),
  });
  assert.strictEqual(t.headers.length, 6);
  assert.strictEqual(t.rows.length, 12);
  assert.ok(t.rows[0].every((c) => c.length <= 60));
  assert.ok(t.rows.every((r) => r.length === 6));
});

test("synthesises blank headers (so it renders) when there is no header row", () => {
  const t = normaliseTableData({ headers: [], rows: [["a"], ["b", "c"]] });
  // Column count comes from the widest row; blank headers let every renderer
  // (preview/PDF/Word) draw the table.
  assert.deepStrictEqual(t.headers, ["", ""]);
  assert.deepStrictEqual(t.rows, [["a", ""], ["b", "c"]]);
});

test("drops fully-empty trailing rows", () => {
  const t = normaliseTableData({ headers: ["A", "B"], rows: [["1", "2"], ["", ""], ["", ""]] });
  assert.deepStrictEqual(t.rows, [["1", "2"]]);
});

test("handles missing/garbage input without throwing", () => {
  assert.deepStrictEqual(normaliseTableData(null), { headers: [], rows: [] });
  assert.deepStrictEqual(normaliseTableData({ rows: "nope" }).rows, []);
});

// ── hasTableContent ─────────────────────────────────────────────────────────
test("hasTableContent is false for an empty grid, true with data", () => {
  assert.strictEqual(hasTableContent({ headers: [], rows: [] }), false);
  assert.strictEqual(hasTableContent({ headers: ["A"], rows: [] }), false);
  assert.strictEqual(hasTableContent({ headers: ["A"], rows: [["1"]] }), true);
  assert.strictEqual(hasTableContent({ headers: [], rows: [["x", "y"]] }), true);
});

// ── runRebuildTable orchestration ───────────────────────────────────────────
await asyncTest("rebuilds a pictograph into normalised tableData", async () => {
  const fetchImage = async () => ({ data: "BASE64", mediaType: "image/png" });
  const readTable = async (image) => {
    assert.strictEqual(image.data, "BASE64");
    return {
      headers: ["Fruit", "People"],
      rows: [["orange", "3"], ["mango", "5"], ["banana", "1"]],
      caption: "Fruit and People",
    };
  };
  const res = await runRebuildTable({ detected: { kind: "pictograph" } }, { fetchImage, readTable });
  assert.strictEqual(res.action, "rebuilt_table");
  assert.strictEqual(res.caption, "Fruit and People");
  assert.deepStrictEqual(res.tableData.headers, ["Fruit", "People"]);
  assert.strictEqual(res.tableData.rows.length, 3);
});

await asyncTest("throws a clear failed-precondition when the image cannot be fetched", async () => {
  await assert.rejects(
    runRebuildTable({}, { fetchImage: async () => null, readTable: async () => ({}) }),
    /Could not read the table image/,
  );
});

await asyncTest("throws when the model returns no usable table", async () => {
  await assert.rejects(
    runRebuildTable(
      {},
      { fetchImage: async () => ({ data: "B", mediaType: "image/png" }), readTable: async () => ({ headers: [], rows: [] }) },
    ),
    /No table could be read/,
  );
});

await asyncTest("rejects when deps are missing", async () => {
  await assert.rejects(runRebuildTable({}, {}), /not configured/);
});

console.log(`\n${passed} rebuildTable assertions passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
