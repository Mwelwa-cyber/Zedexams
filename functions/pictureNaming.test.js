/**
 * Unit tests for the picture-bank auto-naming orchestrator. Plain `node`
 * script (no test runner) — throws on the first failed assertion, matching
 * the repo's other functions/*.test.js files. The Claude client is injected
 * so this runs with no network and no API key.
 *
 * Run: node functions/pictureNaming.test.js
 */

const assert = require("node:assert");
const {
  runNamePictures,
  buildNamingMessages,
  parseNamingResult,
  cleanKeywords,
  cleanSubject,
  MAX_PICTURES_PER_CALL,
  GENERIC_SUBJECT,
} = require("./pictureNaming");

let passed = 0;
function test(name, fn) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ✓ ${name}`);
  });
}
function sync(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const pic = (id) => ({id, mediaType: "image/png", data: "QUJD"}); // "ABC" b64

console.log("pictureNaming");

// ── helpers ──────────────────────────────────────────────────────────────

sync("cleanKeywords lowercases, dedupes, caps and trims", () => {
  const out = cleanKeywords(["Ear", "ear", "  Hearing  ", "x".repeat(80), 42, ""]);
  assert.deepEqual(out.slice(0, 3), ["ear", "hearing", "x".repeat(60)]);
  assert.ok(out.length <= 12);
});

sync("cleanSubject keeps allowed keys and falls back to _generic", () => {
  assert.equal(cleanSubject("Integrated_Science"), "integrated_science");
  assert.equal(cleanSubject("mathematics"), "mathematics");
  assert.equal(cleanSubject("not_a_subject"), GENERIC_SUBJECT);
  assert.equal(cleanSubject(""), GENERIC_SUBJECT);
});

sync("buildNamingMessages interleaves image blocks with index labels", () => {
  const msgs = buildNamingMessages([pic("a"), pic("b")]);
  assert.equal(msgs.length, 1);
  const content = msgs[0].content;
  // text(Image1) image text(Image2) image text(tail) = 5 blocks
  assert.equal(content.filter((c) => c.type === "image").length, 2);
  assert.ok(content[0].text.includes("index 0"));
  assert.equal(content[1].type, "image");
  assert.equal(content[1].source.media_type, "image/png");
  assert.ok(content[content.length - 1].text.includes("name_pictures"));
});

sync("parseNamingResult maps by index, clamps, ignores out-of-range", () => {
  const raw = JSON.stringify({pictures: [
    {index: 1, name: "Map of Zambia", keywords: ["map", "zambia"], subject: "geography"},
    {index: 0, name: "Human ear", keywords: ["ear"], subject: "junk_subject"},
    {index: 9, name: "ignored", keywords: ["x"], subject: "english"},
  ]});
  const byIndex = parseNamingResult(raw, 2);
  assert.equal(byIndex.get(0).name, "Human ear");
  assert.equal(byIndex.get(0).subject, GENERIC_SUBJECT); // junk clamped
  assert.equal(byIndex.get(1).subject, "geography");
  assert.equal(byIndex.has(9), false); // out of range dropped
});

sync("parseNamingResult tolerates garbage", () => {
  const byIndex = parseNamingResult("not json", 3);
  assert.equal(byIndex.size, 0);
});

// ── orchestrator ───────────────────────────────────────────────────────────

async function main() {
  await test("runNamePictures returns one ok result per picture", async () => {
    const calls = [];
    const fakeClaude = async (key, opts) => {
      calls.push(opts);
      return {parsed: {pictures: [
        {index: 0, name: "Human ear, labelled", keywords: ["ear", "hearing"], subject: "integrated_science"},
        {index: 1, name: "Map of Zambia", keywords: ["map", "zambia"], subject: "geography"},
      ]}};
    };
    const {results, warnings} = await runNamePictures(
      {pictures: [pic("a"), pic("b")], anthropicKey: "x"},
      {callClaude: fakeClaude},
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, "tool");
    assert.equal(results.length, 2);
    assert.equal(results[0].id, "a");
    assert.equal(results[0].ok, true);
    assert.equal(results[0].name, "Human ear, labelled");
    assert.equal(results[1].subject, "geography");
    assert.equal(warnings.length, 0);
  });

  await test("runNamePictures marks ok:false when the model skips an image", async () => {
    const fakeClaude = async () => ({parsed: {pictures: [
      {index: 0, name: "Named one", keywords: ["a"], subject: "english"},
    ]}});
    const {results} = await runNamePictures(
      {pictures: [pic("a"), pic("b")], anthropicKey: "x"},
      {callClaude: fakeClaude},
    );
    assert.equal(results[0].ok, true);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].name, "");
  });

  await test("runNamePictures marks empty-name (discard) results ok:false", async () => {
    const fakeClaude = async () => ({parsed: {pictures: [
      {index: 0, name: "", keywords: [], subject: "_generic"},
    ]}});
    const {results} = await runNamePictures(
      {pictures: [pic("a")], anthropicKey: "x"},
      {callClaude: fakeClaude},
    );
    assert.equal(results[0].ok, false);
  });

  await test("runNamePictures chunks above MAX_PICTURES_PER_CALL", async () => {
    let calls = 0;
    const fakeClaude = async (key, opts) => {
      calls += 1;
      const n = opts.messages[0].content.filter((c) => c.type === "image").length;
      const pictures = Array.from({length: n}, (_, i) => ({
        index: i, name: `Pic ${i}`, keywords: ["k"], subject: "_generic",
      }));
      return {parsed: {pictures}};
    };
    const many = Array.from({length: MAX_PICTURES_PER_CALL + 3}, (_, i) => pic(`p${i}`));
    const {results} = await runNamePictures(
      {pictures: many, anthropicKey: "x"},
      {callClaude: fakeClaude},
    );
    assert.equal(calls, 2);
    assert.equal(results.length, many.length);
    assert.ok(results.every((r) => r.ok));
  });

  await test("runNamePictures records a warning when a chunk throws", async () => {
    const fakeClaude = async () => { throw new Error("boom"); };
    const {results, warnings} = await runNamePictures(
      {pictures: [pic("a"), pic("b")], anthropicKey: "x"},
      {callClaude: fakeClaude},
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("boom"));
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.ok === false));
  });

  await test("runNamePictures rejects an empty batch", async () => {
    await assert.rejects(
      () => runNamePictures({pictures: [], anthropicKey: "x"}, {callClaude: async () => ({})}),
      /No pictures to name/,
    );
  });

  await test("runNamePictures skips items without image data", async () => {
    const fakeClaude = async () => ({parsed: {pictures: [
      {index: 0, name: "Only valid", keywords: ["k"], subject: "_generic"},
    ]}});
    const {results} = await runNamePictures(
      {pictures: [pic("a"), {id: "b"}], anthropicKey: "x"},
      {callClaude: fakeClaude},
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "a");
  });

  console.log(`\npictureNaming: ${passed} assertions passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
