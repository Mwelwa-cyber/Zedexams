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
  const maxOutputTokens = Math.min(8000, Math.max(200, Number(opts.maxTokens) || 4000));
  // Monthly spend ceiling — reservation-based hard gate (same as
  // anthropicClient): reserve a conservative max cost up front so concurrent
  // callers can't collectively overspend a stale month-to-date read, settle
  // to the actual cost after, release on failure. Fails open so an
  // accounting glitch never blocks a call.
  const budgetGate = require("./aiCostTracking");
  const gate = await budgetGate.beginAiCall({
    generationId: opts.track && opts.track.generationId,
    model,
    maxTokens: maxOutputTokens,
    provider: "gemini",
  });
  if (!gate.allowed) {
    throw new HttpsError("resource-exhausted", budgetGate.BUDGET_PAUSED_MESSAGE);
  }
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Build the user-turn parts. Always start with the text, then attach
  // an image if one was supplied. Gemini's multimodal API takes either
  // inline_data (base64) or fileData (cloud-storage URI); we use
  // inline_data so the function works with any signed URL the caller
  // already has (Firebase Storage signed URLs, public CDNs, etc.).
  const userParts = [{text: String(opts.userPrompt || "")}];
  if (opts.imageUrl) {
    const inline = await fetchImageAsInlineData(opts.imageUrl);
    if (inline) userParts.push({inline_data: inline});
  }
  // Multi-image vision: the caller can pass already-decoded inline images
  // (base64) directly — used by the scanned-quiz import pipeline, which
  // rasterises PDF pages client-side and hands the bytes to the function
  // rather than round-tripping through a signed URL. Each entry is
  // {mimeType, data} where data is raw base64 (no data-URL prefix).
  if (Array.isArray(opts.images)) {
    for (const img of opts.images) {
      if (!img || !img.data) continue;
      let mimeType = String(img.mimeType || "image/jpeg").split(";")[0].trim();
      if (!/^image\//i.test(mimeType)) mimeType = "image/jpeg";
      userParts.push({inline_data: {mime_type: mimeType, data: String(img.data)}});
    }
  }

  const body = {
    contents: [{role: "user", parts: userParts}],
    generationConfig: {
      temperature: typeof opts.temperature === "number" ? opts.temperature : 0.2,
      maxOutputTokens,
      ...(opts.responseJson ? {responseMimeType: "application/json"} : {}),
    },
  };
  if (opts.systemPrompt) {
    body.systemInstruction = {parts: [{text: String(opts.systemPrompt)}]};
  }

  let data;
  try {
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

    data = await res.json();
  } catch (err) {
    // The call failed → return the reserved budget. Idempotent, never throws.
    budgetGate.releaseAiCall({reservation: gate.reservation})
        .catch((e) => console.warn("[geminiClient] budget release failed", e));
    throw err;
  }
  // Fire-and-forget settle + usage rollup (never throws, never awaited):
  // swaps the reserved max for the ACTUAL cost and lands the spend on the
  // meter the budget ceiling and /admin/ai-costs read. usageMetadata's
  // prompt/candidates counts map onto input/output tokens.
  try {
    const um = data?.usageMetadata;
    budgetGate.settleAiCall({
      reservation: gate.reservation,
      uid: (opts.track && opts.track.uid) || null,
      tool: (opts.track && opts.track.tool) || "gemini",
      model,
      usage: {
        input_tokens: Number(um?.promptTokenCount || 0),
        output_tokens: Number(um?.candidatesTokenCount || 0),
      },
    }).catch((err) => console.warn("[geminiClient] budget settle failed", err));
  } catch (err) {
    console.warn("[geminiClient] cost track failed", err);
  }
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

// Fetch an image URL server-side and convert to Gemini's inline_data
// shape: {mime_type, data: base64}. Returns null if the fetch fails so
// the caller can decide whether to bail or proceed text-only.
async function fetchImageAsInlineData(imageUrl) {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn("Gemini image fetch failed", {status: res.status});
      return null;
    }
    // Gemini accepts the common web image MIMEs. Default to image/jpeg
    // when the server doesn't tell us — Firebase Storage URLs sometimes
    // return application/octet-stream for legacy uploads.
    let mimeType = res.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(mimeType)) mimeType = "image/jpeg";
    // Strip any charset suffix Gemini doesn't accept ("image/jpeg; ...").
    mimeType = mimeType.split(";")[0].trim();
    const buffer = await res.arrayBuffer();
    // Cap at 4 MB to stay well inside Gemini's per-request limit and
    // avoid runaway costs from someone uploading a huge image.
    if (buffer.byteLength > 4 * 1024 * 1024) {
      console.warn("Gemini image too large", {bytes: buffer.byteLength});
      return null;
    }
    const data = Buffer.from(buffer).toString("base64");
    return {mime_type: mimeType, data};
  } catch (err) {
    console.warn("Gemini image fetch threw", {message: err?.message?.slice(0, 200)});
    return null;
  }
}
