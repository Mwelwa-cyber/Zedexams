/**
 * Tests for number-driven re-ask completeness in the scanned-paper importer.
 * Standalone plain-node runner (own async harness) so it doesn't depend on the
 * structure of scannedQuizImport.test.js. Model calls are injected, so it runs
 * with no network and (lazy requires) without functions/node_modules.
 *
 * Run: node functions/scannedQuizReask.test.js
 */

const assert = require("node:assert");
const {
  runScannedQuizImport,
  parseGeminiNumbers,
  computeMissingNumbers,
  expectedBatchNumbers,
  extractedNumberSet,
  flattenSectionQuestions,
  buildReaskMessages,
  MAX_REASK_ROUNDS,
} = require("./scannedQuizImport");

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const dataUrl = () => `data:image/png;base64,${TINY_PNG}`;
const page = (n) => ({pageNumber: n, dataUrl: dataUrl()});

let passed = 0;
const fails = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("  ok " + name);
  } catch (err) {
    fails.push(name + ": " + (err && err.message));
    console.log("  FAIL " + name);
  }
}

const sq = (n) => ({
  kind: "standalone",
  question: {sourceQuestionNumber: n, text: "Q" + n, options: ["a", "b", "c", "d"]},
});
const claudeSections = (nums) => ({
  parsed: {
    sections: nums.map((n) => ({
      kind: "standalone",
      question: {sourceQuestionNumber: n, prompt: "Q" + n, options: ["a", "b", "c", "d"]},
    })),
  },
  stopReason: "tool_use",
  model: "test",
});

(async () => {
  console.log("scannedQuizReask");

  await test("parseGeminiNumbers sorts, dedups, range-filters", () => {
    assert.deepEqual(parseGeminiNumbers('{"questionNumbers":[3,1,2,2,0,9999]}'), [1, 2, 3]);
    assert.deepEqual(parseGeminiNumbers("junk"), []);
  });

  await test("computeMissingNumbers finds expected-not-extracted and caps at 40", () => {
    assert.deepEqual(computeMissingNumbers([1, 2, 3, 4], new Set([1, 3])), [2, 4]);
    const big = computeMissingNumbers(Array.from({length: 100}, (_, i) => i + 1), new Set());
    assert.equal(big.length, 40);
  });

  await test("extractedNumberSet + flattenSectionQuestions cover passages", () => {
    const sections = [
      sq(1),
      {kind: "passage", questions: [{sourceQuestionNumber: 2, text: "x"}, {sourceQuestionNumber: 3, text: "y"}]},
    ];
    assert.deepEqual([...extractedNumberSet(sections)].sort((a, b) => a - b), [1, 2, 3]);
    assert.equal(flattenSectionQuestions(sections).length, 3);
  });

  await test("buildReaskMessages lists the missing numbers + includes page images", () => {
    const [msg] = buildReaskMessages(
      [{pageNumber: 2, mediaType: "image/png", data: "AAA"}],
      {subject: "English"},
      [21, 22],
    );
    const imgs = msg.content.filter((b) => b.type === "image");
    assert.equal(imgs.length, 1);
    const tail = msg.content[msg.content.length - 1].text;
    assert.ok(/21, 22/.test(tail));
    assert.ok(/English/.test(tail));
  });

  await test("orchestrator re-asks for missing numbers and recovers them", async () => {
    let claudeCalls = 0;
    const result = await runScannedQuizImport(
      {pages: [page(1), page(2)], anthropicKey: "k", geminiKey: "g"},
      {
        callGemini: async () => '{"questionNumbers":[1,2,3,4,5]}',
        callClaude: async () => {
          claudeCalls += 1;
          if (claudeCalls === 1) return claudeSections([1, 2, 3]); // missed 4,5
          return claudeSections([4, 5]); // re-ask returns the missing two
        },
      },
    );
    assert.equal(claudeCalls, 2, "should re-ask exactly once");
    assert.equal(result.recovered, 2);
    assert.equal(result.extractedCount, 5, "all 5 questions present after re-ask");
    assert.deepEqual([...extractedNumberSet(result.sections)].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  await test("orchestrator stops when a re-ask round recovers nothing (no loop)", async () => {
    let claudeCalls = 0;
    const result = await runScannedQuizImport(
      {pages: [page(1)], anthropicKey: "k", geminiKey: "g"},
      {
        callGemini: async () => '{"questionNumbers":[1,2,3,4,5]}',
        callClaude: async () => {
          claudeCalls += 1;
          return claudeSections([1, 2, 3]); // never returns 4,5
        },
      },
    );
    assert.equal(claudeCalls, 2, "1 initial + 1 fruitless re-ask, then stop");
    assert.equal(result.recovered, 0);
    assert.equal(result.extractedCount, 3);
  });

  await test("orchestrator does not re-ask without Gemini numbers", async () => {
    let claudeCalls = 0;
    const result = await runScannedQuizImport(
      {pages: [page(1)], anthropicKey: "k", geminiKey: ""},
      {
        callGemini: async () => "{}",
        callClaude: async () => {
          claudeCalls += 1;
          return claudeSections([1, 2, 3]);
        },
      },
    );
    assert.equal(claudeCalls, 1, "no expected-number set → no re-ask");
    assert.equal(result.recovered, 0);
  });

  await test("re-ask respects MAX_REASK_ROUNDS when each round recovers some", async () => {
    let claudeCalls = 0;
    await runScannedQuizImport(
      {pages: [page(1)], anthropicKey: "k", geminiKey: "g"},
      {
        callGemini: async () => '{"questionNumbers":[1,2,3,4,5,6,7,8,9,10]}',
        callClaude: async () => {
          claudeCalls += 1;
          const start = (claudeCalls - 1) * 2 + 1; // round 0:[1,2] round 1:[3,4] ...
          return claudeSections([start, start + 1]);
        },
      },
    );
    assert.equal(claudeCalls, 1 + MAX_REASK_ROUNDS, "1 initial + capped re-asks");
  });

  await test("expectedBatchNumbers fills contiguous gaps both models missed", () => {
    // First pass caught 25,26,28,29 (missed 27); Gemini saw none of them.
    const exp = expectedBatchNumbers([], new Set([25, 26, 28, 29]));
    assert.deepEqual(exp, [25, 26, 27, 28, 29]);
    assert.deepEqual(computeMissingNumbers(exp, new Set([25, 26, 28, 29])), [27]);
  });

  await test("expectedBatchNumbers unions Gemini numbers with the contiguous range", () => {
    assert.deepEqual(expectedBatchNumbers([1, 2, 3, 4, 5], new Set([1, 2, 3])), [1, 2, 3, 4, 5]);
  });

  await test("expectedBatchNumbers guards against a single misread huge number", () => {
    // 25 and 400 would span a 375-wide range — the guard drops it.
    assert.deepEqual(expectedBatchNumbers([], new Set([25, 400])), []);
  });

  await test("orchestrator recovers a gap NEITHER model enumerated (contiguous)", async () => {
    let claudeCalls = 0;
    const result = await runScannedQuizImport(
      {pages: [page(1)], anthropicKey: "k", geminiKey: "g"},
      {
        // Gemini also misses Q3 (same long-list weakness) — it is NOT in the list.
        callGemini: async () => '{"questionNumbers":[1,2,4,5]}',
        callClaude: async () => {
          claudeCalls += 1;
          if (claudeCalls === 1) return claudeSections([1, 2, 4, 5]); // missed 3
          return claudeSections([3]); // re-ask recovers the gap
        },
      },
    );
    assert.equal(result.recovered, 1, "recovered the gap Gemini never listed");
    assert.deepEqual([...extractedNumberSet(result.sections)].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  });

  console.log("\nscannedQuizReask: " + passed + " passed" + (fails.length ? ", " + fails.length + " FAILED" : ""));
  if (fails.length) {
    fails.forEach((f) => console.log("  - " + f));
    process.exit(1);
  }
})();
