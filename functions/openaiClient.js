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

// gpt-image-1 generation is slow but bounded — cap it so a hung request throws
// a clean deadline-exceeded instead of blocking the caller's await until the
// 300s function timeout kills the instance (which the SDK surfaces to the
// client as the bare code "internal"). 120s leaves room for the image download
// + Storage upload that follow within the function's window.
const OPENAI_IMAGE_TIMEOUT_MS = 120000;

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

  // Monthly spend ceiling — images are the priciest per-call spend (~$0.06
  // each) and historically bypassed the gate entirely. Reservation-based hard
  // gate: hold the flat per-image price up front (token rates would misprice
  // gpt-image-1), settle after, release on failure. Fails open so an
  // accounting glitch never blocks a generation.
  const budgetGate = require("./aiCostTracking");
  const gate = await budgetGate.beginAiImageCall({
    generationId: opts.track && opts.track.generationId,
    model, quality, size,
    provider: "openai",
  });
  if (!gate.allowed) {
    throw new HttpsError("resource-exhausted", budgetGate.BUDGET_PAUSED_MESSAGE);
  }
  const releaseGate = () => budgetGate.releaseAiCall({reservation: gate.reservation})
      .catch((e) => console.warn("[openaiClient] budget release failed", e));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_IMAGE_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(OPENAI_ENDPOINT, {
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
      signal: controller.signal,
    });
  } catch (err) {
    releaseGate();
    if (err && err.name === "AbortError") {
      throw new HttpsError(
        "deadline-exceeded",
        "Image generation took too long. Please try again.",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    releaseGate();
    const errBody = await res.text().catch(() => "");
    console.error("OpenAI image error", {status: res.status, model, body: errBody.slice(0, 400)});
    if (res.status === 401) {
      throw new HttpsError(
        "failed-precondition",
        "OpenAI key looks invalid — admin needs to rotate OPENAI_API_KEY in Firebase Secrets.",
      );
    }
    if (res.status === 403) {
      // gpt-image-1 needs the OpenAI organisation to be verified; a 403
      // here is an account-level problem, not a prompt problem.
      throw new HttpsError(
        "failed-precondition",
        "OpenAI rejected the image request (403) — the OpenAI account may " +
        "need organisation verification for gpt-image-1.",
      );
    }
    if (res.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        "OpenAI image API is rate-limited. Wait a moment and try again.",
      );
    }
    // Surface OpenAI's own error message (content-policy rejections, bad
    // params) so admins aren't debugging a bare status code.
    let detail = "";
    try {
      const parsed = JSON.parse(errBody);
      const m = parsed && parsed.error && parsed.error.message;
      if (m) detail = `: ${String(m).slice(0, 160)}`;
    } catch {
      // non-JSON body — the status code alone will have to do
    }
    throw new HttpsError(
      "internal",
      `OpenAI image request failed (${res.status})${detail}`,
    );
  }

  const json = await res.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) {
    releaseGate();
    throw new HttpsError("internal", "OpenAI returned no image data.");
  }
  // Fire-and-forget settle + flat-cost rollup (never throws, never awaited):
  // reconciles the reservation to the flat per-image actual and lands the
  // spend on the meter the budget ceiling and /admin/ai-costs read.
  try {
    budgetGate.settleAiImageCall({
      reservation: gate.reservation,
      uid: (opts.track && opts.track.uid) || null,
      tool: (opts.track && opts.track.tool) || "imageGeneration",
      model, quality, size,
    }).catch((err) => console.warn("[openaiClient] budget settle failed", err));
  } catch (err) {
    console.warn("[openaiClient] image cost track failed", err);
  }
  return {b64, model, size, quality};
}

module.exports = {
  callOpenAIImage,
  ALLOWED_OPENAI_SIZES,
  DEFAULT_OPENAI_IMAGE_MODEL: DEFAULT_MODEL,
};
