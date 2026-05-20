/**
 * Thin REST client for OpenAI's image-generation API (gpt-image-1).
 *
 * Used as a photoreal style toggle on generateDiagram. Recraft remains
 * the default for B&W line-art (cleaner on photocopiers, smaller files);
 * gpt-image-1 is preferred when teachers want a realistic photo — maps,
 * real-world objects, biology specimens, lab apparatus, etc.
 *
 * No SDK dep — same approach as the Recraft and Gemini integrations.
 *
 * Public API: callOpenAIImage(apiKey, opts)
 *   - opts.prompt     — image prompt (already-sanitized by caller)
 *   - opts.size       — '1024x1024' | '1536x1024' | '1024x1536' (OpenAI sizes)
 *   - opts.quality    — 'low' | 'medium' | 'high' (default 'medium')
 *   - opts.model      — defaults to 'gpt-image-1'
 *   Returns a base64-encoded PNG so the caller can stream it into
 *   Firebase Storage with the same downloadToStorage helper. We use b64
 *   rather than the URL response because gpt-image-1 URL is short-lived
 *   and the byte-pipeline matches the Recraft flow.
 */

const {HttpsError} = require("firebase-functions/v2/https");

const OPENAI_ENDPOINT = "https://api.openai.com/v1/images/generations";
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

const ALLOWED_OPENAI_SIZES = new Set([
  "1024x1024",
  "1536x1024", // landscape — closest match for our 1365x1024 Recraft default
  "1024x1536", // portrait
]);
const ALLOWED_OPENAI_QUALITIES = new Set(["low", "medium", "high"]);

async function callOpenAIImage(apiKey, opts = {}) {
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "OpenAI API key is not configured.",
    );
  }
  const prompt = String(opts.prompt || "").slice(0, 4000);
  const size = ALLOWED_OPENAI_SIZES.has(opts.size) ? opts.size : "1536x1024";
  const quality = ALLOWED_OPENAI_QUALITIES.has(opts.quality)
    ? opts.quality
    : "medium";
  const model = opts.model || DEFAULT_MODEL;

  const res = await fetch(OPENAI_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      n: 1,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("OpenAI image error", {status: res.status, model, body: errBody.slice(0, 400)});
    if (res.status === 401) {
      throw new HttpsError(
        "failed-precondition",
        "OpenAI key looks invalid — admin needs to rotate OPENAI_API_KEY in Firebase Secrets.",
      );
    }
    if (res.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        "OpenAI image API is rate-limited. Wait a moment and try again.",
      );
    }
    throw new HttpsError(
      "internal",
      `OpenAI image request failed (${res.status}). Please try again.`,
    );
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    throw new HttpsError("internal", "OpenAI returned no image data.");
  }
  return {b64, model, size, quality};
}

module.exports = {
  callOpenAIImage,
  ALLOWED_OPENAI_SIZES,
  DEFAULT_OPENAI_IMAGE_MODEL: DEFAULT_MODEL,
};
