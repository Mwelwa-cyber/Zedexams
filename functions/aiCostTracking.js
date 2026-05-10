/**
 * AI cost tracking (audit B4).
 *
 * Per-call usage logging that aggregates into per-day rollups so the
 * /admin/ai-costs dashboard can show:
 *   - today's spend + 7-day chart
 *   - top consumers (per-uid totals)
 *   - per-tool breakdown
 *   - anomaly badge when today exceeds 2× the 7-day median
 *
 * Storage shape — three docs per call, all updates via
 * FieldValue.increment so concurrent writes don't collide:
 *
 *   aiUsage/{date}                              // global daily totals
 *     totalInputTokens, totalOutputTokens,
 *     totalCacheCreationTokens, totalCacheReadTokens,
 *     totalCostUsd, callCount, updatedAt
 *
 *   aiUsage/{date}/users/{uid}                  // per-user daily totals
 *     inputTokens, outputTokens, cacheCreation, cacheRead,
 *     costUsd, callCount, updatedAt
 *
 *   aiUsage/{date}/tools/{toolName}             // per-tool daily totals
 *     inputTokens, outputTokens, costUsd, callCount, updatedAt
 *
 * Cost calculation uses a price table keyed on the Anthropic model id.
 * Anthropic's published rates (USD per million tokens) for Claude
 * Sonnet 4.5 are $3 input, $15 output, $0.30 cache read, $3.75 5-min
 * cache write. Sonnet 3.5 / 3.7 are the same shape; Haiku and Opus
 * have separate entries below. Unknown models log at zero cost so we
 * don't fabricate numbers — the call is still counted.
 */

const admin = require("firebase-admin");

// All rates in USD per million tokens.
const PRICE_PER_MTOK = {
  // Default (current production model — keep in sync with ANTHROPIC_MODEL).
  default: {
    input: 3.00,
    output: 15.00,
    cacheCreation5m: 3.75,
    cacheRead: 0.30,
  },
  // Family-prefix overrides. The lookup walks longest-prefix first so
  // a future "claude-haiku-4-5" picks the haiku entry, not default.
  "claude-haiku": {
    input: 1.00,
    output: 5.00,
    cacheCreation5m: 1.25,
    cacheRead: 0.10,
  },
  "claude-opus": {
    input: 15.00,
    output: 75.00,
    cacheCreation5m: 18.75,
    cacheRead: 1.50,
  },
  "claude-sonnet": {
    input: 3.00,
    output: 15.00,
    cacheCreation5m: 3.75,
    cacheRead: 0.30,
  },
};

function pickRates(model) {
  const id = String(model || "").toLowerCase();
  // Longest-prefix match. Family entries are short (~12 chars), full
  // model ids are ~25 chars, so this is fine without a real trie.
  let best = null;
  for (const key of Object.keys(PRICE_PER_MTOK)) {
    if (key === "default") continue;
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  return PRICE_PER_MTOK[best] || PRICE_PER_MTOK.default;
}

function dateKeyUtc() {
  // Same UTC YYYY-MM-DD shape used elsewhere (results.completedAt
  // ISO-slice, dailyExamPicker, etc.). Cheap, no Lusaka-aware logic
  // needed for cost reports.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Compute USD cost from token usage and a model id. All tokens default
 * to 0 if the upstream didn't report them (e.g. a streaming abort).
 */
function computeCostUsd(model, usage = {}) {
  const rates = pickRates(model);
  const input = (usage.input_tokens || 0) * rates.input;
  const output = (usage.output_tokens || 0) * rates.output;
  const cacheCreate = (usage.cache_creation_input_tokens || 0) * rates.cacheCreation5m;
  const cacheRead = (usage.cache_read_input_tokens || 0) * rates.cacheRead;
  return (input + output + cacheCreate + cacheRead) / 1_000_000;
}

/**
 * Fire-and-forget write of one call's usage into the daily rollups.
 * Returns the inferred cost so callers / tests can assert on it, but
 * never throws — accounting failures must not crash the user-facing
 * AI flow.
 *
 *   recordAiUsage({ uid, model, usage, tool })
 *     uid    — auth uid of the caller (null for system / cron usage)
 *     model  — Anthropic model id from the response
 *     usage  — Anthropic usage block: { input_tokens, output_tokens,
 *              cache_creation_input_tokens, cache_read_input_tokens }
 *     tool   — short label of the calling Cloud Function
 *              ('aiChat', 'generateQuiz', 'lessonPlan', etc.)
 */
async function recordAiUsage({uid, model, usage, tool}) {
  try {
    const db = admin.firestore();
    const date = dateKeyUtc();
    const inputTokens = usage?.input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    const cacheCreation = usage?.cache_creation_input_tokens || 0;
    const cacheRead = usage?.cache_read_input_tokens || 0;
    const costUsd = computeCostUsd(model, usage);

    const dayRef = db.collection("aiUsage").doc(date);
    const inc = (n) => admin.firestore.FieldValue.increment(n);
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Ensure the parent doc exists with the date stamped (so list
    // queries on aiUsage can sort by date without an index).
    const dayUpdate = dayRef.set({
      date,
      totalInputTokens: inc(inputTokens),
      totalOutputTokens: inc(outputTokens),
      totalCacheCreationTokens: inc(cacheCreation),
      totalCacheReadTokens: inc(cacheRead),
      totalCostUsd: inc(costUsd),
      callCount: inc(1),
      updatedAt: now,
    }, {merge: true});

    const subUpdates = [];
    if (uid) {
      subUpdates.push(dayRef.collection("users").doc(uid).set({
        uid,
        inputTokens: inc(inputTokens),
        outputTokens: inc(outputTokens),
        cacheCreation: inc(cacheCreation),
        cacheRead: inc(cacheRead),
        costUsd: inc(costUsd),
        callCount: inc(1),
        updatedAt: now,
      }, {merge: true}));
    }
    if (tool) {
      const safeTool = String(tool).slice(0, 64);
      subUpdates.push(dayRef.collection("tools").doc(safeTool).set({
        tool: safeTool,
        inputTokens: inc(inputTokens),
        outputTokens: inc(outputTokens),
        costUsd: inc(costUsd),
        callCount: inc(1),
        updatedAt: now,
      }, {merge: true}));
    }
    await Promise.allSettled([dayUpdate, ...subUpdates]);
    return {costUsd, inputTokens, outputTokens};
  } catch (err) {
    // Accounting NEVER blocks the request. Log + move on.
    console.warn("[aiCostTracking] recordAiUsage failed", err);
    return null;
  }
}

module.exports = {recordAiUsage, computeCostUsd, pickRates, PRICE_PER_MTOK};
