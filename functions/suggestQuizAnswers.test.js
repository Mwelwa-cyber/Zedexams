/**
 * Unit tests for the bulk "suggest answers" engine. Plain `node` script;
 * the Anthropic call is injected so it runs with no network / no deps.
 *
 * Run: node functions/suggestQuizAnswers.test.js
 */

const assert = require("node:assert");
const {
  runSuggestQuizAnswers,
  sanitiseSuggestInput,
  buildSuggestMessages,
  parseSuggestOutput,
  MAX_QUESTIONS,
} = require("./suggestQuizAnswers");

let passed = 0;
function test(name, fn) {
  const r = fn();
  if (r && typeof r.then === "function") {
    return r.then(() => { passed += 1; console.log(`  ✓ ${name}`); });
  }
  passed += 1;
  console.log(`  ✓ ${name}`);
  return undefined;
}

const q = (id, over = {}) => ({ id, text: `Question ${id}`, options: ["a", "b", "c", "d"], ...over });

(async () => {
  console.log("suggestQuizAnswers");

  // ── sanitiseSuggestInput ───────────────────────────────────────────────────

  test("sanitiseSuggestInput keeps valid MCQs and records option counts", () => {
    const { questions, optionCountById } = sanitiseSuggestInput([q("a"), q("b", { options: ["x", "y", "z"] })]);
    assert.equal(questions.length, 2);
    assert.equal(optionCountById.get("a"), 4);
    assert.equal(optionCountById.get("b"), 3);
  });

  test("sanitiseSuggestInput drops items without id, stem, or 2+ options", () => {
    const { questions } = sanitiseSuggestInput([
      { id: "", text: "x", options: ["a", "b"] },
      { id: "n", text: "", options: ["a", "b"] },
      { id: "m", text: "ok", options: ["only"] },
      q("good"),
    ]);
    assert.deepEqual(questions.map(x => x.id), ["good"]);
  });

  test("sanitiseSuggestInput dedupes ids and caps the batch", () => {
    const dup = sanitiseSuggestInput([q("a"), q("a")]);
    assert.equal(dup.questions.length, 1);
    const many = sanitiseSuggestInput(Array.from({ length: MAX_QUESTIONS + 10 }, (_, i) => q(`q${i}`)));
    assert.equal(many.questions.length, MAX_QUESTIONS);
  });

  test("sanitiseSuggestInput keeps blank (picture) option slots for index alignment", () => {
    const { questions } = sanitiseSuggestInput([{ id: "p", text: "pick the shape", options: ["", "", "", ""] }]);
    assert.equal(questions.length, 1);
    assert.equal(questions[0].options.length, 4);
  });

  // ── buildSuggestMessages ───────────────────────────────────────────────────

  test("buildSuggestMessages lists each id with lettered options", () => {
    const [msg] = buildSuggestMessages([q("x1", { text: "2+2?", options: ["3", "4"] })], { subject: "Maths", grade: "7" });
    assert.equal(msg.role, "user");
    assert.ok(/id: x1/.test(msg.content));
    assert.ok(/A\. 3/.test(msg.content) && /B\. 4/.test(msg.content));
    assert.ok(/Maths/.test(msg.content));
  });

  // ── parseSuggestOutput ─────────────────────────────────────────────────────

  test("parseSuggestOutput maps valid in-range answers only", () => {
    const counts = new Map([["a", 4], ["b", 4]]);
    const map = parseSuggestOutput(
      [
        { id: "a", index: 2 },
        { id: "b", index: 9 }, // out of range → dropped
        { id: "c", index: 0 }, // unknown id → dropped
        { id: "a", index: null }, // null → ignored (a already set)
      ],
      counts,
    );
    assert.deepEqual(map, { a: 2 });
  });

  test("parseSuggestOutput drops null / non-integer indices", () => {
    const counts = new Map([["a", 4]]);
    assert.deepEqual(parseSuggestOutput([{ id: "a", index: null }], counts), {});
    assert.deepEqual(parseSuggestOutput([{ id: "a", index: 1.5 }], counts), {});
    assert.deepEqual(parseSuggestOutput([{ id: "a", index: -1 }], counts), {});
  });

  // ── runSuggestQuizAnswers (orchestration, mocked model) ────────────────────

  await test("runSuggestQuizAnswers calls Claude in tool mode and returns a map", async () => {
    let sawTool = false;
    const result = await runSuggestQuizAnswers(
      { questions: [q("a"), q("b")], subject: "Maths", grade: "7", anthropicKey: "k", uid: "u1" },
      {
        callAnthropic: async (key, opts) => {
          assert.equal(key, "k");
          sawTool = Array.isArray(opts.tools) && opts.tools.length === 1;
          assert.equal(opts.temperature, 0);
          return JSON.stringify({ answers: [{ id: "a", index: 1 }, { id: "b", index: 3 }] });
        },
      },
    );
    assert.ok(sawTool, "must use tool mode");
    assert.deepEqual(result.answers, { a: 1, b: 3 });
    assert.equal(result.count, 2);
    assert.equal(result.asked, 2);
  });

  await test("runSuggestQuizAnswers tolerates an already-parsed object result", async () => {
    const result = await runSuggestQuizAnswers(
      { questions: [q("a")], anthropicKey: "k" },
      { callAnthropic: async () => ({ answers: [{ id: "a", index: 0 }] }) },
    );
    assert.deepEqual(result.answers, { a: 0 });
  });

  await test("runSuggestQuizAnswers tolerates malformed model output", async () => {
    const result = await runSuggestQuizAnswers(
      { questions: [q("a")], anthropicKey: "k" },
      { callAnthropic: async () => "not json" },
    );
    assert.deepEqual(result.answers, {});
    assert.equal(result.count, 0);
  });

  await test("runSuggestQuizAnswers throws when no usable questions", async () => {
    await assert.rejects(
      runSuggestQuizAnswers({ questions: [{ id: "", text: "" }], anthropicKey: "k" }, { callAnthropic: async () => "{}" }),
      /No answerable questions/,
    );
  });

  console.log(`\nsuggestQuizAnswers: ${passed} passed`);
})();
