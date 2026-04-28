/**
 * Lightweight Claude client for teacher tools.
 *
 * Deliberately not reusing `aiService.callAnthropic` because:
 *   - It clips responses to 10,000 chars (too tight for full lesson plans).
 *   - It returns a plain string, losing token-usage info we need for cost.
 *
 * Follows the same fetch pattern so behaviour is consistent.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const {anthropicFetch} = require("../anthropicFetch");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";

async function callClaude(apiKey, {
  systemPrompt,
  cbcContextBlock = null,
  messages,
  maxTokens = 4000,
  temperature = 0.3,
  model = DEFAULT_MODEL,
}) {
  let res;
  try {
    // Build system array. The static system prompt is cached so Anthropic skips
    // re-processing it on repeated calls (same prompt, within 5-min TTL).
    // The CBC context block (600-1200 tokens per call) is appended as a second
    // cached block — it changes only when grade/subject/topic changes, so it
    // hits the cache on most repeated uses of the same generator.
    const systemBlocks = systemPrompt ? [
      {type: "text", text: systemPrompt, cache_control: {type: "ephemeral"}},
      ...(cbcContextBlock ? [
        {type: "text", text: cbcContextBlock, cache_control: {type: "ephemeral"}},
      ] : []),
    ] : undefined;

    res = await anthropicFetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        ...(systemBlocks ? {system: systemBlocks} : {}),
        messages,
      }),
    }, {label: "teacherTools"});
  } catch (err) {
    console.error("Claude fetch failed", err);
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error("Claude API error", {
      status: res.status,
      type: body?.error?.type,
      message: body?.error?.message,
    });
    if (res.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        "AI is busy. Please wait a moment and try again.",
      );
    }
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b?.type === "text" && b?.text)
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    text,
    usage: {
      inputTokens: Number(data?.usage?.input_tokens || 0),
      outputTokens: Number(data?.usage?.output_tokens || 0),
    },
    stopReason: data?.stop_reason || null,
    model: data?.model || model,
  };
}

module.exports = {callClaude, DEFAULT_MODEL};
