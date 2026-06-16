/**
 * Node test for the OpenAI entries in aiCostTracking's price table.
 * Run: node functions/aiCostOpenAi.test.js
 *
 * Zed chat moved from Claude to OpenAI; recordAiUsage now logs that spend
 * onto the same /admin/ai-costs rollup, normalising OpenAI's
 * {prompt_tokens, completion_tokens} to {input_tokens, output_tokens}.
 * These assertions make sure the gpt-* models are priced from their own
 * rows (never the Anthropic Sonnet "default") and that the longest-prefix
 * lookup keeps "gpt-4o-mini" off the pricier "gpt-4o" rate.
 */

const assert = require("node:assert");
const {pickRates, computeCostUsd, PRICE_PER_MTOK} = require("./aiCostTracking");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("aiCostOpenAi");

// ── pickRates: gpt-* models resolve to their own rows ─────────────────────
ok("gpt-4o-mini → mini rates",
  pickRates("gpt-4o-mini") === PRICE_PER_MTOK["gpt-4o-mini"]);
ok("gpt-4o → 4o rates", pickRates("gpt-4o") === PRICE_PER_MTOK["gpt-4o"]);

// Dated/suffixed ids must still hit the right family via longest-prefix.
ok("gpt-4o-mini-2024-07-18 → mini (longest prefix beats gpt-4o)",
  pickRates("gpt-4o-mini-2024-07-18") === PRICE_PER_MTOK["gpt-4o-mini"]);
ok("gpt-4o-2024-08-06 → 4o",
  pickRates("gpt-4o-2024-08-06") === PRICE_PER_MTOK["gpt-4o"]);

// Unknown gpt-* must hit the catch-all, never the Anthropic default.
ok("gpt-5-mini → gpt catch-all (not Sonnet default)",
  pickRates("gpt-5-mini") === PRICE_PER_MTOK["gpt"]);
ok("gpt catch-all output rate is cheaper than the Anthropic default",
  PRICE_PER_MTOK["gpt"].output < PRICE_PER_MTOK.default.output);

// Anthropic ids are untouched by the new rows.
ok("claude-sonnet-4-6 still → sonnet rates",
  pickRates("claude-sonnet-4-6") === PRICE_PER_MTOK["claude-sonnet"]);
ok("claude-haiku-4-5 still → haiku rates",
  pickRates("claude-haiku-4-5") === PRICE_PER_MTOK["claude-haiku"]);

// ── computeCostUsd: priced from the normalised input/output token shape ───
{
  // 1M input + 1M output on gpt-4o-mini → $0.15 + $0.60.
  const cost = computeCostUsd("gpt-4o-mini", {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  });
  ok("gpt-4o-mini 1M+1M tokens → $0.75", Math.abs(cost - 0.75) < 1e-9);
}
{
  // A realistic Zed turn: ~1.5k in, ~0.4k out → fractions of a cent.
  const cost = computeCostUsd("gpt-4o-mini", {
    input_tokens: 1500,
    output_tokens: 400,
  });
  const expected = (1500 * 0.15 + 400 * 0.60) / 1_000_000;
  ok("gpt-4o-mini small turn priced correctly",
    Math.abs(cost - expected) < 1e-12);
}

console.log(`\n─── ${passed} assertions · all passed ───`);
