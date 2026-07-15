/**
 * Node test for the provider price rows + flat image pricing in
 * aiCostTracking.js. Run: node functions/aiCostProviders.test.js
 *
 * Teacher-generator (callClaude), Gemini, gpt-image-1, and embeddings spend
 * historically never reached recordAiUsage — the budget ceiling and the
 * /admin/ai-costs dashboards were enforcing against a meter that couldn't
 * see the largest spend categories. These assertions pin:
 *   - the Gemini / embeddings price rows (never priced at the Sonnet default)
 *   - the unknown-model zero-cost fallback (count the call, don't fabricate)
 *   - the claude-* family fallback to default production rates
 *   - imageCostUsd's flat per-image matrix (quality × size, prefix lookup)
 *   - recordAiImageUsage / recordAiUsage rollup writes via a stubbed Firestore
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

const {
  pickRates,
  computeCostUsd,
  imageCostUsd,
  recordAiUsage,
  recordAiImageUsage,
  isOverBudget,
  PRICE_PER_MTOK,
  _resetBudgetCache,
} = require("./aiCostTracking");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("aiCostProviders");

// ── pickRates: Gemini rows ─────────────────────────────────────────────────
ok("gemini-2.5-flash → its own row",
  pickRates("gemini-2.5-flash") === PRICE_PER_MTOK["gemini-2.5-flash"]);
ok("gemini-2.5-flash-lite → flash row via longest prefix",
  pickRates("gemini-2.5-flash-lite") === PRICE_PER_MTOK["gemini-2.5-flash"]);
ok("unknown gemini-* → gemini catch-all (not Sonnet default)",
  pickRates("gemini-3-pro") === PRICE_PER_MTOK["gemini"]);

// ── pickRates: embeddings rows ─────────────────────────────────────────────
ok("text-embedding-3-small → its own row",
  pickRates("text-embedding-3-small") === PRICE_PER_MTOK["text-embedding-3-small"]);
ok("text-embedding-3-large → its own row",
  pickRates("text-embedding-3-large") === PRICE_PER_MTOK["text-embedding-3-large"]);

// ── pickRates: fallbacks ───────────────────────────────────────────────────
ok("future claude family (no row) → default production rates",
  pickRates("claude-nova-1") === PRICE_PER_MTOK.default);
ok("existing claude families keep their rows",
  pickRates("claude-haiku-4-5-20251001") === PRICE_PER_MTOK["claude-haiku"]);
{
  const r = pickRates("totally-unknown-model");
  ok("unknown non-claude model → zero rates (never Sonnet default)",
    r.input === 0 && r.output === 0 && r !== PRICE_PER_MTOK.default);
}
ok("unknown model 1M+1M tokens costs $0 (counted, not fabricated)",
  computeCostUsd("totally-unknown-model",
    {input_tokens: 1_000_000, output_tokens: 1_000_000}) === 0);

// ── computeCostUsd: gemini text spend is priced ────────────────────────────
{
  const cost = computeCostUsd("gemini-2.5-flash", {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  });
  ok("gemini-2.5-flash 1M+1M tokens → $2.80", Math.abs(cost - 2.80) < 1e-9);
}

// ── imageCostUsd: flat per-image matrix ────────────────────────────────────
ok("gpt-image-1 medium landscape → $0.063 (the '~$0.06/image' in generateDiagram)",
  Math.abs(imageCostUsd("gpt-image-1", {quality: "medium", size: "1536x1024"}) - 0.063) < 1e-9);
ok("gpt-image-1 low square → $0.011",
  Math.abs(imageCostUsd("gpt-image-1", {quality: "low", size: "1024x1024"}) - 0.011) < 1e-9);
ok("gpt-image-1 high portrait → $0.25",
  Math.abs(imageCostUsd("gpt-image-1", {quality: "high", size: "1024x1536"}) - 0.25) < 1e-9);
ok("gemini image model → flat rate, quality/size ignored",
  imageCostUsd("gemini-2.5-flash-image", {}) === 0.039);
ok("unknown image model → $0",
  imageCostUsd("recraft-v3", {quality: "high", size: "1024x1024"}) === 0);
ok("known model, unknown size → $0 (don't fabricate)",
  imageCostUsd("gpt-image-1", {quality: "medium", size: "512x512"}) === 0);

// ── rollup writes via a stubbed Firestore ──────────────────────────────────
// Mirrors aiCostBudget.test.js's defineProperty stub (admin.firestore is a
// non-writable namespace getter). Captures every set() with its doc path.
function stubFirestoreCapture(monthCostUsd = 0) {
  const writes = [];
  const makeDoc = (path) => ({
    set: async (data, opts) => writes.push({path, data, opts}),
    get: async () => ({exists: true, data: () => ({totalCostUsd: monthCostUsd})}),
    collection: (name) => makeColl(`${path}/${name}`),
  });
  // Collections support doc() for writes and an (empty) get() for the sharded
  // month reader, which sums doc().collection('shards').get().
  const makeColl = (path) => ({
    doc: (id) => makeDoc(`${path}/${id}`),
    get: async () => ({forEach: () => {}, docs: []}),
  });
  const fs = () => ({collection: (name) => makeColl(name)});
  fs.FieldValue = {
    increment: (n) => ({__inc: n}),
    serverTimestamp: () => ({__ts: true}),
  };
  Object.defineProperty(admin, "firestore", {configurable: true, value: fs});
  return writes;
}

(async () => {
  {
    const writes = stubFirestoreCapture();
    const res = await recordAiImageUsage({
      uid: "teacher1",
      model: "gpt-image-1",
      quality: "medium",
      size: "1536x1024",
      tool: "diagram",
    });
    ok("recordAiImageUsage returns the flat cost",
      res && Math.abs(res.costUsd - 0.063) < 1e-9 && res.inputTokens === 0);
    // Day totals now land on a SHARD doc (aiUsage/{date}/shards/{shardId}).
    const day = writes.find((w) => /^aiUsage\/\d{4}-\d{2}-\d{2}\/shards\/\d+$/.test(w.path));
    ok("image spend lands on the daily rollup shard",
      day && Math.abs(day.data.totalCostUsd.__inc - 0.063) < 1e-9 &&
      day.data.callCount.__inc === 1);
    // Month totals on a SHARD doc (aiUsageMonthly/{month}/shards/{shardId}).
    const month = writes.find((w) => /^aiUsageMonthly\/[\d-]+\/shards\/\d+$/.test(w.path));
    ok("image spend lands on the monthly rollup the ceiling reads",
      month && Math.abs(month.data.totalCostUsd.__inc - 0.063) < 1e-9);
    // Per-user doc unchanged; per-tool lands on a flattened tool shard.
    ok("image spend attributes to the user and tool rollups",
      writes.some((w) => w.path.endsWith("/users/teacher1")) &&
      writes.some((w) => /\/toolShards\/diagram__\d+$/.test(w.path)));
  }

  {
    const writes = stubFirestoreCapture();
    const res = await recordAiUsage({
      uid: null,
      model: "gemini-2.5-flash",
      usage: {input_tokens: 500_000, output_tokens: 100_000},
      tool: "documentImport",
    });
    ok("gemini usage records at gemini rates",
      res && Math.abs(res.costUsd - (0.5 * 0.30 + 0.1 * 2.50)) < 1e-9);
    ok("null uid skips the per-user rollup but keeps the tool rollup",
      !writes.some((w) => w.path.includes("/users/")) &&
      writes.some((w) => /\/toolShards\/documentImport__\d+$/.test(w.path)));
  }

  // ── isOverBudget: the shared client gate ─────────────────────────────────
  const ORIG = process.env.AI_MONTHLY_BUDGET_USD;
  const ORIG_MODE = process.env.AI_BUDGET_MODE;
  delete process.env.AI_BUDGET_MODE;
  try {
    delete process.env.AI_MONTHLY_BUDGET_USD;
    _resetBudgetCache();
    stubFirestoreCapture(999);
    ok("no ceiling armed → isOverBudget false", (await isOverBudget()) === false);

    process.env.AI_MONTHLY_BUDGET_USD = "10";
    _resetBudgetCache();
    stubFirestoreCapture(5);
    ok("under ceiling → isOverBudget false", (await isOverBudget()) === false);

    _resetBudgetCache();
    stubFirestoreCapture(15);
    ok("over ceiling → isOverBudget true", (await isOverBudget()) === true);
  } finally {
    if (ORIG === undefined) delete process.env.AI_MONTHLY_BUDGET_USD;
    else process.env.AI_MONTHLY_BUDGET_USD = ORIG;
    if (ORIG_MODE !== undefined) process.env.AI_BUDGET_MODE = ORIG_MODE;
    _resetBudgetCache();
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
