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
async function embedText(apiKey, text, opts = {}) {
  const input = String(text == null ? "" : text).slice(0, MAX_INPUT_CHARS).trim();
  if (!apiKey || typeof fetch !== "function" || !input) return null;
  try {
    // Monthly spend ceiling. embedText's contract is null-never-throw, so an
    // armed, exhausted budget degrades to null — Qix's dedup then falls back
    // to its exact/near-text checks instead of the semantic pass.
    const {isOverBudget} = require("./aiCostTracking");
    if (await isOverBudget()) {
      console.warn("[openaiEmbeddings] monthly AI budget reached — skipping embed");
      return null;
    }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({model: opts.model || DEFAULT_MODEL, input}),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn("[openaiEmbeddings] embed failed", res.status, errText.slice(0, 200));
      return null;
    }
    const json = await res.json();
    // Fire-and-forget usage rollup (never throws, never awaited). OpenAI's
    // embeddings usage block reports prompt_tokens only; output is 0.
    try {
      const {recordAiUsage} = require("./aiCostTracking");
      recordAiUsage({
        uid: (opts.track && opts.track.uid) || null,
        tool: (opts.track && opts.track.tool) || "embeddings",
        model: json?.model || opts.model || DEFAULT_MODEL,
        usage: {input_tokens: Number(json?.usage?.prompt_tokens || 0)},
      });
    } catch (trackErr) {
      console.warn("[openaiEmbeddings] cost track failed", trackErr);
    }
    const vec = json && json.data && json.data[0] && json.data[0].embedding;
    return Array.isArray(vec) ? vec : null;
  } catch (err) {
    console.warn("[openaiEmbeddings] embed threw", err && err.message);
    return null;
  }
}

module.exports = {embedText, EMBED_MODEL: DEFAULT_MODEL};
