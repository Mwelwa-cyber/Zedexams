/**
 * Unit tests for Reva — the Content Reviewer runner.
 *
 * Reva's value is in how it parses and clamps the model's JSON verdict:
 * unparseable output must fall back to a safe "needs manual review" verdict
 * rather than blocking, and out-of-range verdict/severity values must be
 * pinned to known enums. The Anthropic call is injected so none of this
 * touches the network.
 *
 *   node functions/agents/runners/reva.test.js
 */

const assert = require("node:assert");
const {runReva} = require("./reva");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

// Build a job with an Aria draft (and optional Cala alignment).
function job(draft = {body: "a lesson draft"}, cala = {aligned: true}) {
  return {input: {grade: "6", subject: "Maths", topic: "Numbers", tool: "worksheet"},
    output: {aria: {draft}, cala}};
}

// An injected caller that returns a fixed raw string and records the call.
function llmReturning(raw, sink) {
  return async (apiKey, opts) => {
    if (sink) sink.push({apiKey, opts});
    return raw;
  };
}

async function run() {
  // ── refusal gate ───────────────────────────────────────────────────
  await test("throws when Aria has not produced a draft", async () => {
    await assert.rejects(
      () => runReva({job: {output: {}}, callLLM: llmReturning("{}"), getApiKey: () => "k"}),
      /Aria must run first/,
    );
  });

  // ── a clean, valid verdict passes through ──────────────────────────
  await test("passes a well-formed verdict through and clamps nothing", async () => {
    const sink = [];
    const raw = JSON.stringify({
      verdict: "approve",
      severity: "low",
      summary: "Reads well for Grade 6.",
      edits: [{where: "intro", suggestion: "tighten", reason: "too long"}],
    });
    const out = await runReva({
      job: job(),
      anthropicApiKeySecret: {},
      callLLM: llmReturning(raw, sink),
      getApiKey: () => "resolved",
    });
    assert.strictEqual(out.verdict, "approve");
    assert.strictEqual(out.severity, "low");
    assert.strictEqual(out.summary, "Reads well for Grade 6.");
    assert.strictEqual(out.edits.length, 1);
    assert.deepStrictEqual(out.edits[0], {where: "intro", suggestion: "tighten", reason: "too long"});
    // The resolved key was handed to the caller; JSON mode was requested.
    assert.strictEqual(sink[0].apiKey, "resolved");
    assert.strictEqual(sink[0].opts.json, true);
  });

  // ── unparseable output → safe fallback, never a throw ──────────────
  await test("falls back to a manual-review verdict when output is not JSON", async () => {
    const out = await runReva({
      job: job(),
      callLLM: llmReturning("the model rambled with no json at all"),
      getApiKey: () => "k",
    });
    assert.strictEqual(out.verdict, "revise");
    assert.strictEqual(out.severity, "medium");
    assert.match(out.summary, /could not parse/i);
    assert.deepStrictEqual(out.edits, []);
    assert.ok(typeof out.raw === "string");
  });

  // ── JSON embedded in prose is still recovered ──────────────────────
  await test("recovers a JSON object embedded in surrounding prose", async () => {
    const raw = "Here is my review:\n{\"verdict\":\"reject\",\"severity\":\"high\",\"summary\":\"Off syllabus.\"}\nThanks!";
    const out = await runReva({job: job(), callLLM: llmReturning(raw), getApiKey: () => "k"});
    assert.strictEqual(out.verdict, "reject");
    assert.strictEqual(out.severity, "high");
    assert.strictEqual(out.summary, "Off syllabus.");
  });

  // ── out-of-range verdict/severity are clamped to safe defaults ─────
  await test("clamps an unknown verdict and severity to safe defaults", async () => {
    const raw = JSON.stringify({verdict: "obliterate", severity: "catastrophic", summary: "x"});
    const out = await runReva({job: job(), callLLM: llmReturning(raw), getApiKey: () => "k"});
    assert.strictEqual(out.verdict, "revise");
    assert.strictEqual(out.severity, "medium");
  });

  // ── runaway edit lists are capped and field-clamped ────────────────
  await test("caps the edits array at 50 and clamps each edit's fields", async () => {
    const edits = Array.from({length: 80}, (_, i) => ({
      where: "w".repeat(500) + i,
      suggestion: "s".repeat(5000),
      reason: "r".repeat(5000),
    }));
    const raw = JSON.stringify({verdict: "revise", severity: "medium", summary: "y", edits});
    const out = await runReva({job: job(), callLLM: llmReturning(raw), getApiKey: () => "k"});
    assert.strictEqual(out.edits.length, 50, "edits capped at 50");
    assert.ok(out.edits[0].where.length <= 200, "where clamped to 200");
    assert.ok(out.edits[0].suggestion.length <= 1000, "suggestion clamped to 1000");
    assert.ok(out.edits[0].reason.length <= 500, "reason clamped to 500");
  });

  await test("tolerates a verdict object with a non-array edits field", async () => {
    const raw = JSON.stringify({verdict: "approve", severity: "low", summary: "ok", edits: "nope"});
    const out = await runReva({job: job(), callLLM: llmReturning(raw), getApiKey: () => "k"});
    assert.deepStrictEqual(out.edits, []);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
