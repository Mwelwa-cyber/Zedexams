/**
 * Per-model request shaping (anthropicRequestPolicy.js) and its one wiring
 * point, anthropicFetch.
 *
 * Why it matters: Sonnet 5 answers a non-default `temperature` with a 400, and
 * almost every call here sends one (callClaude defaults it to 0.3). Without the
 * policy, setting ANTHROPIC_MODEL=claude-sonnet-5 would fail every generator.
 * The other half of the contract is just as important: a model the policy does
 * not target must go out BYTE-IDENTICAL, or this change would silently alter
 * today's Sonnet 4.5 / Haiku output.
 *
 * Plain `node` script. Run: node functions/anthropicRequestPolicy.test.js
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const {applyRequestPolicy, requestPolicyFor, parseModel} = require("./anthropicRequestPolicy");
const {anthropicFetch} = require("./anthropicFetch");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const baseBody = (model, extra = {}) => ({
  model,
  max_tokens: 4000,
  temperature: 0.3,
  system: [{type: "text", text: "sys"}],
  messages: [{role: "user", content: "hi"}],
  ...extra,
});

async function main() {
  console.log("\nanthropicRequestPolicy — which models refuse what\n");

  await test("parses dated, dotted and bare ids", () => {
    assert.deepStrictEqual(parseModel("claude-haiku-4-5-20251001"), {family: "haiku", major: 4, minor: 5});
    assert.deepStrictEqual(parseModel("claude-sonnet-5"), {family: "sonnet", major: 5, minor: 0});
    assert.deepStrictEqual(parseModel("claude-opus-4-7"), {family: "opus", major: 4, minor: 7});
    assert.strictEqual(parseModel("gpt-4o-mini"), null);
    assert.strictEqual(parseModel(undefined), null);
  });

  await test("today's models keep sampling and their thinking default", () => {
    for (const m of ["claude-sonnet-4-5", "claude-sonnet-4-6", "claude-haiku-4-5",
      "claude-haiku-4-5-20251001", "claude-opus-4-6", "claude-opus-4-5"]) {
      assert.deepStrictEqual(requestPolicyFor(m),
          {rejectsSampling: false, pinThinkingDisabled: false}, m);
    }
  });

  await test("Sonnet 5 refuses sampling and has thinking pinned off", () => {
    assert.deepStrictEqual(requestPolicyFor("claude-sonnet-5"),
        {rejectsSampling: true, pinThinkingDisabled: true});
  });

  await test("Opus 4.7+ and the 5 generation refuse sampling, thinking left alone", () => {
    for (const m of ["claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-fable-5"]) {
      assert.deepStrictEqual(requestPolicyFor(m),
          {rejectsSampling: true, pinThinkingDisabled: false}, m);
    }
  });

  await test("an unrecognised id is left exactly as sent", () => {
    const body = baseBody("some-future-model");
    const out = applyRequestPolicy(body);
    assert.strictEqual(out.changed, false);
    assert.strictEqual(out.body, body);
  });

  await test("Sonnet 5 body: sampling dropped, thinking disabled, nothing else touched", () => {
    const body = baseBody("claude-sonnet-5", {top_p: 0.9, top_k: 40});
    const {body: out, changed} = applyRequestPolicy(body);
    assert.strictEqual(changed, true);
    assert.ok(!("temperature" in out) && !("top_p" in out) && !("top_k" in out));
    assert.deepStrictEqual(out.thinking, {type: "disabled"});
    assert.deepStrictEqual(out.messages, body.messages);
    assert.deepStrictEqual(out.system, body.system);
    assert.strictEqual(out.max_tokens, 4000);
    assert.strictEqual(body.temperature, 0.3, "the caller's object is not mutated");
  });

  await test("an explicit thinking setting is the caller's, never overridden", () => {
    const thinking = {type: "adaptive"};
    const {body: out} = applyRequestPolicy(baseBody("claude-sonnet-5", {thinking}));
    assert.strictEqual(out.thinking, thinking);
  });

  console.log("\nanthropicFetch — shapes the body it actually sends\n");

  const realFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, init) => {
    sent.push({url, init});
    return {ok: true, status: 200, headers: {get: () => null}};
  };
  try {
    await test("a Sonnet 4.5 request goes out as the very same body string", async () => {
      const init = {method: "POST", body: JSON.stringify(baseBody("claude-sonnet-4-5"))};
      await anthropicFetch(MESSAGES_URL, init);
      assert.strictEqual(sent.at(-1).init, init);
    });

    await test("a Sonnet 5 request goes out without temperature and with thinking off", async () => {
      await anthropicFetch(MESSAGES_URL, {method: "POST",
        headers: {"x-api-key": "k"}, body: JSON.stringify(baseBody("claude-sonnet-5"))});
      const {init} = sent.at(-1);
      const body = JSON.parse(init.body);
      assert.ok(!("temperature" in body));
      assert.deepStrictEqual(body.thinking, {type: "disabled"});
      assert.deepStrictEqual(init.headers, {"x-api-key": "k"}, "headers survive the rewrite");
    });

    await test("only the Messages endpoint is shaped", async () => {
      const init = {method: "POST", body: JSON.stringify(baseBody("claude-sonnet-5"))};
      await anthropicFetch("https://api.anthropic.com/v1/messages/count_tokens", init);
      assert.strictEqual(sent.at(-1).init, init);
    });

    await test("a body that is not JSON is passed through untouched", async () => {
      const init = {method: "POST", body: "not json"};
      await anthropicFetch(MESSAGES_URL, init);
      assert.strictEqual(sent.at(-1).init, init);
    });
  } finally {
    global.fetch = realFetch;
  }

  console.log("\nevery Messages caller goes through anthropicFetch\n");

  await test("no file sends an anthropic-version header without anthropicFetch", () => {
    // The policy only works if it stays the one choke point. A new caller that
    // calls fetch() directly would send `temperature` to Sonnet 5 and 400.
    // The Managed Agents runner (dawn.js) talks to a different API and sends
    // no Messages body, so it is the one named exception.
    const EXEMPT = new Set(["agents/runners/dawn.js"]);
    const offenders = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue;
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".js") && !name.endsWith(".test.js")) {
          const rel = path.relative(__dirname, full).split(path.sep).join("/");
          const src = fs.readFileSync(full, "utf8");
          if (/api\.anthropic\.com/.test(src) && /anthropic-version/.test(src) &&
              !/anthropicFetch/.test(src) && !EXEMPT.has(rel)) offenders.push(rel);
        }
      }
    };
    walk(__dirname);
    assert.deepStrictEqual(offenders, [], `call Anthropic through anthropicFetch: ${offenders.join(", ")}`);
  });

  console.log(`\n${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
