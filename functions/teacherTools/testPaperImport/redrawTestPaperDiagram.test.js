/**
 * Unit tests for runRedrawTestPaperDiagram — the orchestration that carries out
 * a teacher's chosen Diagram Handling Option. Model/Firestore/Storage are
 * injected as deps, so this runs under plain `node` with no network.
 *
 * Run: node functions/teacherTools/testPaperImport/redrawTestPaperDiagram.test.js
 */

const assert = require("assert");
const {runRedrawTestPaperDiagram} = require("./redrawTestPaperDiagram");

let passed = 0;
function test(name, fn) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}

const detected = {kind: "plant", caption: "Flowering plant", labels: ["stem", "roots"]};
const context = {subject: "Science", grade: "Grade 4", topic: "Plants"};

async function run() {
  console.log("redrawTestPaperDiagram");

  await test("rejects an unknown handling option", async () => {
    await assert.rejects(
      () => runRedrawTestPaperDiagram({detected, handling: "bogus"}, {}),
      /Unknown diagram handling option/,
    );
  });

  await test("rejects a missing diagram description", async () => {
    await assert.rejects(
      () => runRedrawTestPaperDiagram({handling: "redraw"}, {}),
      /No diagram description/,
    );
  });

  await test("remove → no generation, null url", async () => {
    let generated = false;
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "remove"},
      {generateImage: async () => { generated = true; return {url: "x"}; }},
    );
    assert.strictEqual(res.action, "removed");
    assert.strictEqual(res.url, null);
    assert.strictEqual(generated, false);
  });

  await test("keep_original → returns the original url, no generation", async () => {
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "keep_original", originalUrl: "https://orig/x.png"},
      {},
    );
    assert.strictEqual(res.action, "kept_original");
    assert.strictEqual(res.url, "https://orig/x.png");
    assert.strictEqual(res.source, "original");
  });

  await test("clean_original → keeps original and flags cleaned:false", async () => {
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "clean_original", originalUrl: "https://orig/x.png"},
      {},
    );
    assert.strictEqual(res.action, "kept_clean");
    assert.strictEqual(res.cleaned, false);
  });

  await test("redraw → reuses a strong library match without generating", async () => {
    let generated = false;
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "redraw", context},
      {
        searchLibrary: async () => [
          {id: "lib1", url: "https://lib/plant.png", subject: "science",
            name: "Flowering plant", keywords: ["plant", "stem", "roots"]},
        ],
        generateImage: async () => { generated = true; return {url: "https://gen/x.png"}; },
      },
    );
    assert.strictEqual(res.action, "reused");
    assert.strictEqual(res.source, "library");
    assert.strictEqual(res.url, "https://lib/plant.png");
    assert.strictEqual(res.pictureId, "lib1");
    assert.strictEqual(generated, false);
  });

  await test("redraw → generates + saves when no library match", async () => {
    let saved = null;
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "redraw", context},
      {
        searchLibrary: async () => [
          {id: "x", url: "u", subject: "social", name: "Map", keywords: ["map"]},
        ],
        generateImage: async (brief) => {
          assert.match(brief.prompt, /black-and-white line art/i);
          return {url: "https://gen/x.png", sizeBytes: 1234};
        },
        saveToLibrary: async (meta) => { saved = meta; return {id: "new1"}; },
      },
    );
    assert.strictEqual(res.action, "redrawn");
    assert.strictEqual(res.source, "generated");
    assert.strictEqual(res.url, "https://gen/x.png");
    assert.strictEqual(res.savedToLibrary, true);
    assert.strictEqual(res.pictureId, "new1");
    assert.ok(saved && saved.status === "staged");
  });

  await test("forceNew → skips library reuse and generates", async () => {
    let searched = false;
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "replace", context, forceNew: true},
      {
        searchLibrary: async () => { searched = true; return []; },
        generateImage: async () => ({url: "https://gen/y.png"}),
      },
    );
    assert.strictEqual(searched, false);
    assert.strictEqual(res.action, "replaced");
    assert.strictEqual(res.source, "generated");
  });

  await test("library search failure falls through to generation", async () => {
    const res = await runRedrawTestPaperDiagram(
      {detected, handling: "redraw", context},
      {
        searchLibrary: async () => { throw new Error("firestore down"); },
        generateImage: async () => ({url: "https://gen/z.png"}),
      },
    );
    assert.strictEqual(res.source, "generated");
    assert.strictEqual(res.url, "https://gen/z.png");
  });

  await test("generation returning no url throws", async () => {
    await assert.rejects(
      () => runRedrawTestPaperDiagram(
        {detected, handling: "redraw", context, forceNew: true},
        {generateImage: async () => ({})},
      ),
      /returned no diagram/i,
    );
  });

  console.log(`\nredrawTestPaperDiagram: ${passed} passed\n`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
