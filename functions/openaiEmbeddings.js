/**
 * Thin REST client for OpenAI's text-embeddings API — no SDK dep, same
 * approach as openaiClient.js / the curriculum ingester's embedChunks.
 *
 * Public API:
 *   embedText(apiKey, text, opts?)  → number[] | null   (single text)
 *
 * Returns null (never throws) on a missing key, no fetch, a non-2xx
 * response, or a malformed body — so callers degrade gracefully. Used by the
 * Qix review agent for semantic duplicate detection.
 */

const ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
// text-embedding-3-small handles ~8k tokens; clamp the input so an oversized
// stem can't blow the request. ~8000 chars is comfortably under the limit.
const MAX_INPUT_CHARS = 8000;

/**
 * Embed a single text into a vector. Resolves to null on any failure.
 * @param {string} apiKey
 * @param {string} text
 * @param {{model?:string}} [opts]
 * @returns {Promise<number[]|null>}
 */
// ~8000 chars of input is roughly 2000 tokens; 4000 keeps the budget hold
// conservative without the text-call default's 40k-token input allowance,
// which would over-hold for such tiny requests.
const EMBED_INPUT_ALLOWANCE_TOKENS = 4000;

async function embedText(apiKey, text, opts = {}) {
  const input = String(text == null ? "" : text).slice(0, MAX_INPUT_CHARS).trim();
  if (!apiKey || typeof fetch !== "function" || !input) return null;
  let gate = null;
  const releaseGate = () => {
    if (!gate || !gate.reservation) return;
    try {
      require("./aiCostTracking").releaseAiCall({reservation: gate.reservation})
          .catch((e) => console.warn("[openaiEmbeddings] budget release failed", e && e.message));
    } catch {
      // release is best-effort; the TTL reclaim frees a stranded hold anyway
    }
  };
  try {
    // Monthly spend ceiling — reservation-based hard gate (embeddings are
    // input-only, so the hold prices output at $0). embedText's contract is
    // null-never-throw, so an armed, exhausted budget degrades to null —
    // Qix's dedup then falls back to its exact/near-text checks instead of
    // the semantic pass.
    const budgetGate = require("./aiCostTracking");
    const model = opts.model || DEFAULT_MODEL;
    gate = await budgetGate.beginAiCall({
      model,
      maxTokens: 0,
      inputAllowanceTokens: EMBED_INPUT_ALLOWANCE_TOKENS,
      provider: "embeddings",
    });
    if (!gate.allowed) {
      console.warn("[openaiEmbeddings] monthly AI budget reached — skipping embed");
      return null;
    }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({model, input}),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[openaiEmbeddings] embed failed", res.status, errText.slice(0, 200));
      releaseGate();
      return null;
    }
    const json = await res.json();
    // Fire-and-forget settle + usage rollup (never throws, never awaited).
    // OpenAI's embeddings usage block reports prompt_tokens only; output is 0.
    try {
      budgetGate.settleAiCall({
        reservation: gate.reservation,
        uid: (opts.track && opts.track.uid) || null,
        tool: (opts.track && opts.track.tool) || "embeddings",
        model: json?.model || model,
        usage: {input_tokens: Number(json?.usage?.prompt_tokens || 0)},
      }).catch((trackErr) => console.warn("[openaiEmbeddings] budget settle failed", trackErr));
    } catch (trackErr) {
      console.warn("[openaiEmbeddings] cost track failed", trackErr);
    }
    const vec = json && json.data && json.data[0] && json.data[0].embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (err) {
    releaseGate();
    console.warn("[openaiEmbeddings] embed threw", err && err.message);
    return null;
  }
}

module.exports = {embedText, EMBED_MODEL: DEFAULT_MODEL};
