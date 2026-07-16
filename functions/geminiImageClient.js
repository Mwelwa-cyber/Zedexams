/**
 * Thin REST client for Google's Gemini image-generation API.
 *
 * Mirrors the shape of geminiClient.js (text) and openaiClient.js so
 * generateNotePictures.js can swap providers without ceremony.
 *
 * The model that generates images is Gemini 2.5 Flash Image (GA id
 * "gemini-2.5-flash-image"). Nano-banana rejects image-only modality
 * requests; the body MUST request BOTH TEXT and IMAGE modalities —
 * the text part usually comes back empty and is discarded.
 *
 * Public API: callGeminiImage(apiKey, opts)
 *   - opts.prompt      — image description (already-sanitized by caller)
 *   - opts.model       — defaults to GEMINI_IMAGE_MODEL env var or
 *                        'gemini-2.5-flash-image'
 *   Returns { b64, mimeType } where b64 is a raw base64-encoded PNG/JPEG.
 *   Callers are responsible for uploading to Storage.
 */

const {HttpsError} = require("firebase-functions/v2/https");

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Allow the model id to be overridden at deploy time without a code change
// (e.g. for testing a preview model). Default is the GA image model id.
const DEFAULT_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

async function callGeminiImage(apiKey, opts = {}) {
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Gemini API key is not configured.",
    );
  }

  const prompt = String(opts.prompt || "").slice(0, 2000);
  if (!prompt) {
    throw new HttpsError("invalid-argument", "Image prompt is required.");
  }

  const model = opts.model || DEFAULT_IMAGE_MODEL;

  // Monthly spend ceiling — reservation-based hard gate, same as the other
  // model clients. The hold is sized off the flat per-image price (Gemini
  // image spend is never token-priced), settled after the call, released on
  // failure. Fails open so an accounting glitch never blocks.
  const budgetGate = require("./aiCostTracking");
  const gate = await budgetGate.beginAiImageCall({
    generationId: opts.track && opts.track.generationId,
    model,
    provider: "gemini",
  });
  if (!gate.allowed) {
    throw new HttpsError("resource-exhausted", budgetGate.BUDGET_PAUSED_MESSAGE);
  }
  const releaseGate = () => budgetGate.releaseAiCall({reservation: gate.reservation})
      .catch((e) => console.warn("[geminiImageClient] budget release failed", e));

  const url =
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

  // Nano-banana requires BOTH modalities. Requesting only "IMAGE" makes the
  // API return a 400 with "Only image modality is not supported". The text
  // part is usually empty and we discard it; we keep both here so the
  // request is accepted.
  const body = {
    contents: [
      {
        role: "user",
        parts: [{text: prompt}],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  let data;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Include the full response body so failures are debuggable in logs
      // without needing to replay the request.
      const errBody = await res.text().catch(() => "");
      console.error("Gemini image API error", {
        status: res.status,
        model,
        body: errBody.slice(0, 600),
      });
      throw new Error(
        `Gemini image request failed (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
      );
    }

    data = await res.json();
  } catch (err) {
    releaseGate();
    throw err;
  }
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];

  // The model returns the image as an inlineData part. Walk all parts and
  // return the first image blob found; ignore text parts.
  for (const part of parts) {
    const inline = part?.inlineData;
    if (inline && inline.data && inline.mimeType) {
      // Fire-and-forget settle + flat-cost rollup (never throws, never
      // awaited): reconciles the reservation to the flat per-image actual
      // and lands the spend on the budget meter + /admin/ai-costs.
      try {
        budgetGate.settleAiImageCall({
          reservation: gate.reservation,
          uid: (opts.track && opts.track.uid) || null,
          tool: (opts.track && opts.track.tool) || "imageGeneration",
          model,
        }).catch((err) => console.warn("[geminiImageClient] budget settle failed", err));
      } catch (err) {
        console.warn("[geminiImageClient] image cost track failed", err);
      }
      return {b64: String(inline.data), mimeType: String(inline.mimeType)};
    }
  }

  // No inline image found — log enough to diagnose.
  releaseGate();
  console.error("Gemini image returned no inlineData", {
    finishReason: candidate?.finishReason,
    blockReason: data?.promptFeedback?.blockReason,
    partCount: parts.length,
    partTypes: parts.map((p) => Object.keys(p || {}).join(",")),
  });
  throw new Error(
    "Gemini image generation returned no image data." +
    (candidate?.finishReason ? ` Finish reason: ${candidate.finishReason}.` : ""),
  );
}

module.exports = {callGeminiImage, DEFAULT_IMAGE_MODEL};
