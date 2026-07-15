/**
 * Lightweight Claude client for teacher tools.
 *
 * Deliberately not reusing `aiService.callAnthropic` because:
 *   - It clips responses to 10,000 chars (too tight for full lesson plans).
 *   - It returns a plain string, losing token-usage info we need for cost.
 *
 * Modes:
 *   - "json"   (default) — single blocking request. Returns full text; the
 *               caller parses JSON from it.
 *   - "tool"   — forces Claude to emit structured JSON via a single tool call,
 *               eliminating JSON-fence stripping and "non-JSON output" parse
 *               failures. The tool's `input_schema` is intentionally
 *               permissive — the prompt already describes the schema in detail
 *               and the existing post-call validators do strict checks. The
 *               win here is the SHAPE of the response: Claude can no longer
 *               wrap its output in prose, markdown fences, or commentary.
 *   - "stream" — streams Anthropic SSE deltas to an `onToken(text)` callback;
 *               returns the accumulated text + usage when the stream closes.
 *               Used by the SSE-streaming HTTP endpoints in `index.js`.
 */

const {HttpsError} = require("firebase-functions/v2/https");
const {anthropicFetch} = require("../anthropicFetch");
const {buildSystemBlocks} = require("./systemBlocks");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
// When the primary model is exhausted/overloaded after anthropicFetch's own
// HTTP-level retries, or returns unusable output, we re-attempt on this sibling
// model so the teacher still receives the generation they paid a quota slot for
// — rather than refunding the credit and leaving them empty-handed. Override per
// runtime with ANTHROPIC_FALLBACK_MODEL.
const FALLBACK_MODEL = process.env.ANTHROPIC_FALLBACK_MODEL || "claude-sonnet-4-5";

function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

function unwrapApiError(res, errBody) {
  console.error("Claude API error", {
    status: res.status,
    type: errBody?.error?.type,
    message: errBody?.error?.message,
  });
  if (res.status === 429) {
    return new HttpsError(
      "resource-exhausted",
      "AI is busy. Please wait a moment and try again.",
    );
  }
  return new HttpsError(
    "unavailable",
    "AI is temporarily unavailable. Please try again.",
  );
}

function extractUsage(data) {
  return {
    inputTokens: Number(data?.usage?.input_tokens || 0),
    outputTokens: Number(data?.usage?.output_tokens || 0),
    cacheReadTokens: Number(data?.usage?.cache_read_input_tokens || 0),
    cacheCreationTokens: Number(data?.usage?.cache_creation_input_tokens || 0),
  };
}

/**
 * Classify a callClaude failure for the deliver-the-product retry loop.
 *
 *   "shape"        — the model replied but the structured output was unusable
 *                    (missing tool_use block / malformed tool JSON). A re-roll
 *                    on the SAME model usually fixes a one-off bad generation.
 *   "unavailable"  — the request never produced a usable reply (rate-limited
 *                    after anthropicFetch's own retries, overloaded, 5xx, or a
 *                    network error). Worth re-attempting on the FALLBACK model.
 *   null           — not worth re-attempting (bad input, budget ceiling, or an
 *                    unrecognised error). Propagate immediately.
 */
function isDeliverableRetry(err) {
  if (!err) return null;
  const code = err.code;
  if (code === "resource-exhausted" || code === "unavailable") return "unavailable";
  if (code === "internal") return "shape";
  return null;
}

/**
 * Ordered model ladder: the requested (or default) model first, then the
 * configured fallback when it differs. De-duped so a single-model ladder still
 * gets its one shape re-roll.
 */
function buildModelLadder(requestedModel) {
  const primary = requestedModel || DEFAULT_MODEL;
  const ladder = [primary];
  if (FALLBACK_MODEL && FALLBACK_MODEL !== primary) ladder.push(FALLBACK_MODEL);
  return ladder;
}

/**
 * Run `dispatch(model)` across the model ladder so a transient failure still
 * delivers a result instead of burning the teacher's quota. Per model: one
 * re-roll on a "shape" error, then fall forward to the next model on any
 * deliverable-retryable error. Streaming callers pass `streamProgressed()` —
 * once any token has reached the client we must NOT retry (it would double-send
 * progress), so we propagate the error instead.
 */
async function attemptWithFallback({models, dispatch, streamProgressed}) {
  let lastErr;
  for (let mi = 0; mi < models.length; mi++) {
    // Two tries per model: the initial attempt plus one shape re-roll.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await dispatch(models[mi]);
      } catch (err) {
        lastErr = err;
        // Never re-run a stream that already streamed content to the client.
        if (typeof streamProgressed === "function" && streamProgressed()) throw err;
        const kind = isDeliverableRetry(err);
        if (!kind) throw err;
        if (kind === "shape" && attempt === 0) {
          console.warn(
            `[teacherTools] unusable output from ${models[mi]} — re-rolling`,
          );
          continue; // re-roll on the same model
        }
        if (models[mi + 1]) {
          console.warn(
            `[teacherTools] ${models[mi]} ${kind} — falling back to ` +
            `${models[mi + 1]}`,
          );
        }
        break; // move to the next model in the ladder
      }
    }
  }
  throw lastErr;
}

async function callClaude(apiKey, opts = {}) {
  const {
    systemPrompt,
    cbcContextBlock = null,
    formatContextBlock = null,
    messages,
    maxTokens = 4000,
    temperature = 0.3,
    model = DEFAULT_MODEL,
    mode = "json",
    // Tool-mode params:
    toolName,
    toolDescription,
    toolInputSchema,
    // Stream-mode params:
    onToken,
    // Optional reasoning controls. Both pass straight to Anthropic when set.
    //   thinking:     {type: "disabled" | "adaptive" | "enabled", ...}
    //   outputConfig: {effort: "low" | "medium" | "high" | "max"}
    // For Sonnet 4.6, pair `thinking: {type: "disabled"}` + `effort: "low"` to
    // match Sonnet 4.5 baseline latency. Without setting effort, 4.6 defaults
    // to "high", which is slower and costlier.
    thinking,
    outputConfig,
    // Cost attribution for the /admin/ai-costs rollups: {uid, tool}. Optional
    // — without it the call still records under the shared "teacherTools"
    // tool label so the monthly ceiling always sees this spend.
    track,
  } = opts;

  // Monthly spend ceiling — reservation-based hard gate. Reserves a
  // conservative max cost up front so concurrent generations can't all read a
  // stale "under budget" total and collectively overspend. No-op unless a
  // ceiling is armed; fails open so an accounting glitch never blocks a
  // generation. The reservation is reconciled to the actual cost after the
  // call (settleAiCall) or released on failure (releaseAiCall).
  const budgetGate = require("../aiCostTracking");
  const reservationGate = await budgetGate.beginAiCall({
    generationId: track && track.generationId,
    model,
    maxTokens,
  });
  if (!reservationGate.allowed) {
    throw new HttpsError("resource-exhausted", budgetGate.BUDGET_PAUSED_MESSAGE);
  }

  // Validate mode + required params up front so config errors fail fast and
  // never enter the retry loop (they are not "deliverable").
  if (mode !== "json" && mode !== "tool" && mode !== "stream") {
    throw new HttpsError("invalid-argument", `Unknown callClaude mode: ${mode}`);
  }
  if (mode === "tool" && (!toolName || !toolInputSchema)) {
    throw new HttpsError(
      "internal",
      "callClaude(mode:'tool') requires toolName and toolInputSchema.",
    );
  }
  if (mode === "stream" && typeof onToken !== "function") {
    throw new HttpsError(
      "internal",
      "callClaude(mode:'stream') requires an onToken callback.",
    );
  }

  // Track whether the stream has emitted anything yet; once it has, a retry
  // would double-send progress to the client, so attemptWithFallback bails.
  let streamProgressed = false;
  const wrappedOnToken = (typeof onToken === "function") ?
    (text, kind) => {
      streamProgressed = true;
      return onToken(text, kind);
    } : onToken;

  const sharedArgs = {
    apiKey, systemPrompt, cbcContextBlock, formatContextBlock, messages,
    maxTokens, temperature, thinking, outputConfig,
  };

  const dispatch = (attemptModel) => {
    const args = {...sharedArgs, model: attemptModel};
    if (mode === "json") return callClaudeJson(args);
    if (mode === "tool") {
      return callClaudeTool({
        ...args, toolName, toolDescription, toolInputSchema,
      });
    }
    return callClaudeStream({
      ...args, onToken: wrappedOnToken,
      // Optional tool params — when set, stream tool input_json_delta
      // and return parsed JSON instead of plain text.
      toolName, toolDescription, toolInputSchema,
    });
  };

  let result;
  try {
    result = await attemptWithFallback({
      models: buildModelLadder(model),
      dispatch,
      streamProgressed: () => streamProgressed,
    });
  } catch (err) {
    // The call failed → return the reserved budget so a burst of failures
    // can't strand the month's ceiling. Idempotent + never throws.
    budgetGate.releaseAiCall({reservation: reservationGate.reservation})
        .catch((e) => console.warn("[anthropicClient] release failed", e));
    throw err;
  }

  // Fire-and-forget reconcile + usage rollup (same idiom as aiService —
  // never awaited on the response path). settleAiCall swaps the reserved
  // amount for the ACTUAL cost in its bucket AND records the call in the
  // sharded /admin/ai-costs + monthly-ceiling counters. A result with no
  // usage means nothing was billed, so we just release the reservation.
  if (result && result.usage) {
    try {
      budgetGate.settleAiCall({
        reservation: reservationGate.reservation,
        uid: (track && track.uid) || null,
        tool: (track && track.tool) || "teacherTools",
        model: result.model || model,
        usage: {
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens,
          cache_creation_input_tokens: result.usage.cacheCreationTokens,
          cache_read_input_tokens: result.usage.cacheReadTokens,
        },
      }).catch((err) => console.warn("[anthropicClient] settle/track failed", err));
    } catch (err) {
      console.warn("[anthropicClient] cost track failed", err);
    }
  } else {
    budgetGate.releaseAiCall({reservation: reservationGate.reservation})
        .catch((e) => console.warn("[anthropicClient] release failed", e));
  }
  return result;
}

// Helper: build the optional reasoning-control fields. Caller passes the
// already-snake-cased keys via JSON (Anthropic uses `output_config` and
// `thinking` at the top level of the request body).
function buildReasoningFields({thinking, outputConfig}) {
  return {
    ...(thinking ? {thinking} : {}),
    ...(outputConfig ? {output_config: outputConfig} : {}),
  };
}

async function callClaudeJson({
  apiKey, systemPrompt, cbcContextBlock, formatContextBlock, messages,
  maxTokens, temperature, model, thinking, outputConfig,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    ...(systemPrompt ?
      {system: buildSystemBlocks(
        systemPrompt, cbcContextBlock, formatContextBlock)} : {}),
    messages,
    ...buildReasoningFields({thinking, outputConfig}),
  };
  const res = await postAnthropic(apiKey, body);
  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b?.type === "text" && b?.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    text,
    usage: extractUsage(data),
    stopReason: data?.stop_reason || null,
    model: data?.model || model,
  };
}

async function callClaudeTool({
  apiKey, systemPrompt, cbcContextBlock, formatContextBlock, messages,
  maxTokens, temperature, model, thinking, outputConfig,
  toolName, toolDescription, toolInputSchema,
}) {
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    ...(systemPrompt ?
      {system: buildSystemBlocks(
        systemPrompt, cbcContextBlock, formatContextBlock)} : {}),
    messages,
    tools: [{
      name: toolName,
      description: toolDescription || "Emit the result as a structured object.",
      input_schema: toolInputSchema,
    }],
    tool_choice: {type: "tool", name: toolName},
    ...buildReasoningFields({thinking, outputConfig}),
  };
  const res = await postAnthropic(apiKey, body);
  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const toolUse = blocks.find(
    (b) => b?.type === "tool_use" && b?.name === toolName,
  );
  if (!toolUse || !toolUse.input || typeof toolUse.input !== "object") {
    console.error("Claude tool-use response missing tool_use block", {
      stopReason: data?.stop_reason,
      blockTypes: blocks.map((b) => b?.type),
    });
    throw new HttpsError(
      "internal",
      "AI returned an unexpected response shape. Please try again.",
    );
  }
  // Surface any text the model emitted alongside the tool call so callers
  // can persist it for debugging — usually empty when tool_choice forces a tool.
  const text = blocks
    .filter((b) => b?.type === "text" && b?.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    parsed: toolUse.input,
    text,
    usage: extractUsage(data),
    stopReason: data?.stop_reason || null,
    model: data?.model || model,
  };
}

async function callClaudeStream({
  apiKey, systemPrompt, cbcContextBlock, formatContextBlock, messages,
  maxTokens, temperature, model, thinking, outputConfig, onToken,
  toolName, toolDescription, toolInputSchema,
}) {
  const wantsTool = Boolean(toolName && toolInputSchema);
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    stream: true,
    ...(systemPrompt ?
      {system: buildSystemBlocks(
        systemPrompt, cbcContextBlock, formatContextBlock)} : {}),
    messages,
    ...(wantsTool ? {
      tools: [{
        name: toolName,
        description: toolDescription || "Emit the result as a structured object.",
        input_schema: toolInputSchema,
      }],
      tool_choice: {type: "tool", name: toolName},
    } : {}),
    ...buildReasoningFields({thinking, outputConfig}),
  };

  let res;
  try {
    res = await anthropicFetch(ANTHROPIC_URL, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
    }, {label: "teacherTools:stream"});
  } catch (err) {
    console.error("Claude stream fetch failed", err);
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw unwrapApiError(res, errBody);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // For text streams, fullText accumulates content; for tool streams,
  // toolJsonBuffer accumulates partial_json deltas (Anthropic emits the
  // tool input as a JSON string in chunks via input_json_delta).
  let fullText = "";
  let toolJsonBuffer = "";
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  let stopReason = null;
  let modelOut = model;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (parsed.type === "message_start" && parsed.message) {
        modelOut = parsed.message.model || modelOut;
        const u = parsed.message.usage || {};
        usage.inputTokens = Number(u.input_tokens || 0);
        usage.cacheReadTokens = Number(u.cache_read_input_tokens || 0);
        usage.cacheCreationTokens = Number(u.cache_creation_input_tokens || 0);
      } else if (parsed.type === "content_block_delta" && parsed.delta) {
        const d = parsed.delta;
        if (d.type === "text_delta" && typeof d.text === "string") {
          fullText += d.text;
          try {
            onToken(d.text, "text");
          } catch (err) {
            console.warn("onToken callback threw", err);
          }
        } else if (d.type === "input_json_delta" &&
                   typeof d.partial_json === "string") {
          toolJsonBuffer += d.partial_json;
          try {
            onToken(d.partial_json, "tool_json");
          } catch (err) {
            console.warn("onToken callback threw", err);
          }
        }
      } else if (parsed.type === "message_delta") {
        if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
        if (parsed.usage?.output_tokens != null) {
          usage.outputTokens = Number(parsed.usage.output_tokens);
        }
      }
    }
  }

  // For tool streams, parse the accumulated JSON. Empty/invalid JSON throws
  // through to the caller for the same handling as a non-streaming tool call.
  let parsedTool = null;
  if (wantsTool) {
    if (!toolJsonBuffer.trim()) {
      console.error("Tool stream produced no input_json_delta", {stopReason});
      throw new HttpsError(
        "internal",
        "AI returned an unexpected response shape. Please try again.",
      );
    }
    try {
      parsedTool = JSON.parse(toolJsonBuffer);
    } catch (err) {
      console.error("Tool stream JSON parse failed", {
        bufferLen: toolJsonBuffer.length,
        message: err?.message,
      });
      throw new HttpsError(
        "internal",
        "AI returned malformed structured output. Please try again.",
      );
    }
  }

  return {
    text: fullText,
    parsed: parsedTool,
    usage,
    stopReason,
    model: modelOut,
  };
}

async function postAnthropic(apiKey, body) {
  let res;
  try {
    res = await anthropicFetch(ANTHROPIC_URL, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
    }, {label: "teacherTools"});
  } catch (err) {
    console.error("Claude fetch failed", err);
    throw new HttpsError(
      "unavailable",
      "AI is temporarily unavailable. Please try again.",
    );
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw unwrapApiError(res, errBody);
  }
  return res;
}

module.exports = {
  callClaude,
  DEFAULT_MODEL,
  FALLBACK_MODEL,
  // Exported for unit tests of the deliver-the-product retry/fallback logic.
  isDeliverableRetry,
  buildModelLadder,
  attemptWithFallback,
};
