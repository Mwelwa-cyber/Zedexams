/**
 * Claude tool-loop driver for the Zed Telegram assistant.
 *
 * Calls Anthropic Messages API with a tool definition list, executes any
 * tool_use blocks the model emits, feeds the results back, and loops until
 * the model returns a final text answer (stop_reason === "end_turn") or we
 * hit the iteration cap. Returns the final assistant text plus a transcript
 * for logging.
 *
 * Why hand-rolled instead of reusing aiService.callAnthropic:
 *   - We need the full content array (tool_use + text blocks), not the
 *     joined-text shortcut callAnthropic returns.
 *   - We loop on tool_use, which callAnthropic doesn't.
 */

const {anthropicFetch} = require("../anthropicFetch");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = process.env.ZED_ASSISTANT_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  "claude-sonnet-4-5";
const MAX_TOOL_ITERATIONS = 6;
const MAX_OUTPUT_TOKENS = 1500;

async function postAnthropic(apiKey, body) {
  const res = await anthropicFetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  }, {label: "zedAssistant"});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Anthropic API error: ${message}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function extractTextBlocks(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && b?.text)
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function extractToolUseBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b?.type === "tool_use");
}

/**
 * Run the tool-loop.
 *
 * @param {string} apiKey Anthropic API key.
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {Array} opts.messages Initial messages array (must start with user).
 * @param {Array} opts.tools Anthropic tool definitions.
 * @param {Function} opts.runTool async (name, input) => result string/object.
 * @returns {Promise<{text: string, toolCalls: Array, stopReason: string}>}
 */
async function runAgent(apiKey, {systemPrompt, messages, tools, runTool}) {
  const conversation = [...messages];
  const toolCalls = [];
  let lastResponse;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const body = {
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.3,
      ...(systemPrompt ? {
        system: [{
          type: "text",
          text: systemPrompt,
          cache_control: {type: "ephemeral"},
        }],
      } : {}),
      ...(tools && tools.length ? {tools} : {}),
      messages: conversation,
    };

    lastResponse = await postAnthropic(apiKey, body);
    const assistantContent = lastResponse?.content || [];

    // Always echo the assistant turn back into the conversation.
    conversation.push({role: "assistant", content: assistantContent});

    const toolUseBlocks = extractToolUseBlocks(assistantContent);
    if (lastResponse.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      // Model is done or didn't request a tool — return whatever text we have.
      return {
        text: extractTextBlocks(assistantContent),
        toolCalls,
        stopReason: lastResponse.stop_reason,
      };
    }

    // Execute every tool block in order, then send all results back together.
    const toolResults = [];
    for (const block of toolUseBlocks) {
      const name = block.name;
      const input = block.input || {};
      let resultText;
      let isError = false;
      try {
        const raw = await runTool(name, input);
        resultText = typeof raw === "string" ?
          raw :
          JSON.stringify(raw, null, 2);
      } catch (err) {
        isError = true;
        resultText = `Tool ${name} failed: ${err?.message || "unknown error"}`;
        console.error("zedAssistant tool error", {name, message: err?.message});
      }
      toolCalls.push({name, input, ok: !isError, output: resultText});
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultText.slice(0, 12000),
        ...(isError ? {is_error: true} : {}),
      });
    }
    conversation.push({role: "user", content: toolResults});
  }

  // Bailed out of the loop — return whatever the last text was, plus a note.
  const fallbackText = lastResponse ?
    extractTextBlocks(lastResponse.content || []) :
    "";
  return {
    text: fallbackText ||
      "I ran out of steps before finishing that. Try a more focused question.",
    toolCalls,
    stopReason: "max_iterations",
  };
}

module.exports = {runAgent};
