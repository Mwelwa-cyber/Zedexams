/**
 * Thin REST client for Google's Gemini API.
 *
 * We use the REST endpoint directly (rather than the @google/generative-ai
 * SDK) to keep the deploy bundle small and avoid pulling another SDK with
 * its own auth quirks. Same approach as the Recraft integration.
 *
 * Currently used by the document-import pipeline: Gemini 2.5 Flash's
 * 1M-token context lets it ingest entire textbook chapters without
 * chunking, which is its concrete advantage over Claude for that job.
 *
 * Public API: callGemini(apiKey, opts)
 *   - opts.systemPrompt   — system instructions (becomes systemInstruction)
 *   - opts.userPrompt     — main user message
 *   - opts.model          — defaults to 'gemini-2.5-flash'
 *   - opts.maxTokens      — generation cap (default 4000)
 *   - opts.temperature    — default 0.2
 *   - opts.responseJson   — if true, force JSON response with responseMimeType
 *   Returns the raw text reply (caller parses if responseJson was set).
 */

const {HttpsError} = require("firebase-functions/v2/https");

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function callGemini(apiKey, opts = {}) {
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Gemini API key is not configured.",
    );
  }
  const model = opts.model || DEFAULT_MODEL;
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {role: "user", parts: [{text: String(opts.userPrompt || "")}]},
    ],
    generationConfig: {
      temperature: typeof opts.temperature === "number" ? opts.temperature : 0.2,
      maxOutputTokens: Math.min(8000, Math.max(200, Number(opts.maxTokens) || 4000)),
      ...(opts.responseJson ? {responseMimeType: "application/json"} : {}),
    },
  };
  if (opts.systemPrompt) {
    body.systemInstruction = {parts: [{text: String(opts.systemPrompt)}]};
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("Gemini API error", {status: res.status, model, body: errBody.slice(0, 400)});
    throw new HttpsError(
      "internal",
      `Gemini request failed (${res.status}). Please try again.`,
    );
  }

  const data = await res.json();
  // Gemini returns candidates[0].content.parts[].text; concatenate any
  // text parts so we don't drop content if the model emits multiple.
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();
  if (!text) {
    console.error("Gemini returned no text", {
      finishReason: candidate?.finishReason,
      blockReason: data?.promptFeedback?.blockReason,
    });
    throw new HttpsError("internal", "Gemini returned an empty response.");
  }
  return text;
}

module.exports = {callGemini, DEFAULT_MODEL};
