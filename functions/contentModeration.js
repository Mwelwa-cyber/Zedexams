"use strict";

/**
 * contentModeration — learner-facing content moderation (AI-003).
 *
 * Wraps OpenAI's omni-moderation endpoint and the pure decision logic in
 * contentModerationCore.js. Used to screen learner INPUT and model OUTPUT on
 * the child-facing AI surfaces (Zed chat `aiChat` / `apiAiChat`, short-answer
 * marking `checkShortAnswer`) — the only prior guardrail was a bypassable
 * system prompt.
 *
 * Policy: a positive unsafe verdict (see DEFAULT_BLOCKED_CATEGORIES) always
 * blocks; a moderation SERVICE error fails OPEN by default (availability — the
 * model's own safety still applies) and can be flipped to fail-closed via
 * MODERATION_FAIL_CLOSED=true. The whole layer is gated by
 * LEARNER_MODERATION_ENABLED (default on) so it can be disabled instantly
 * without a redeploy.
 */

const {decideContentOutcome, DEFAULT_BLOCKED_CATEGORIES} = require("./contentModerationCore");

const MODERATION_ENDPOINT = "https://api.openai.com/v1/moderations";
const MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";
const MODERATION_TIMEOUT_MS = 8000;
// The omni-moderation API caps a single request; we clamp to this many chars
// per call. Named so `checkLearnerTextWindowed` screens longer text in windows
// of exactly this size instead of silently ignoring the overflow.
const MODERATION_INPUT_CHARS = 8000;
// Overlap between windows so a phrase straddling a window boundary is still
// seen whole by at least one call.
const MODERATION_WINDOW_OVERLAP = 256;

// Friendly, non-scary refusal shown to a child when their message is blocked.
const LEARNER_BLOCK_MESSAGE =
  "I can't help with that one. Let's keep our chat about your schoolwork — " +
  "try asking me about a subject, a topic, or a question you're stuck on.";

function moderationEnabled() {
  return String(process.env.LEARNER_MODERATION_ENABLED || "true").toLowerCase() !== "false";
}

function failClosedOnError() {
  return String(process.env.MODERATION_FAIL_CLOSED || "false").toLowerCase() === "true";
}

/**
 * Call the OpenAI moderation endpoint. Returns the parsed JSON, or throws.
 * @param {string} apiKey
 * @param {string} input
 * @returns {Promise<object>}
 */
async function moderateText(apiKey, input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODERATION_TIMEOUT_MS);
  try {
    const res = await fetch(MODERATION_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({model: MODERATION_MODEL, input: String(input || "").slice(0, MODERATION_INPUT_CHARS)}),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`moderation HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Screen a single piece of learner-facing text. Never throws — a moderation
 * failure resolves to the configured fail-open/closed outcome so a caller can
 * always make a decision. Empty text is allowed without a network call.
 *
 * @param {string} apiKey
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.failClosed]
 * @param {string[]} [opts.blockedCategories]
 * @param {string} [opts.label]  For logging (e.g. "aiChat:input").
 * @returns {Promise<{allowed:boolean, blocked:boolean, reason:string, matchedCategories:string[], flaggedCategories:string[], skipped?:boolean}>}
 */
async function checkLearnerText(apiKey, text, opts = {}) {
  const {failClosed = failClosedOnError(), blockedCategories = DEFAULT_BLOCKED_CATEGORIES, label = "moderation"} = opts;
  const clean = String(text || "").trim();
  if (!moderationEnabled() || !clean || !apiKey) {
    return {allowed: true, blocked: false, reason: "skipped", matchedCategories: [], flaggedCategories: [], skipped: true};
  }
  let apiResult = null;
  let errored = false;
  try {
    apiResult = await moderateText(apiKey, clean);
  } catch (err) {
    errored = true;
    console.warn(`[contentModeration] ${label} moderation call failed`, {message: err?.message?.slice(0, 200)});
  }
  const outcome = decideContentOutcome({apiResult, errored, failClosed, blockedCategories});
  if (outcome.blocked) {
    // Structured, PII-free audit line so blocked content is observable without
    // logging the child's actual message.
    console.warn(`[contentModeration] blocked ${label}`, {
      reason: outcome.reason,
      categories: outcome.matchedCategories,
    });
  }
  return outcome;
}

/**
 * Screen text of ANY length. `moderateText` clamps a single call to
 * MODERATION_INPUT_CHARS, so a long reply (a model reply is only token-capped,
 * not char-capped) is screened here in overlapping windows and blocked if ANY
 * window is flagged — content after the first window must not slip through.
 * Short text takes exactly one call, identical to `checkLearnerText`.
 *
 * @returns {Promise<{allowed:boolean, blocked:boolean, reason:string, matchedCategories:string[], flaggedCategories:string[], skipped?:boolean}>}
 */
async function checkLearnerTextWindowed(apiKey, text, opts = {}) {
  const str = String(text || "");
  if (str.length <= MODERATION_INPUT_CHARS) {
    return checkLearnerText(apiKey, str, opts);
  }
  const step = MODERATION_INPUT_CHARS - MODERATION_WINDOW_OVERLAP;
  let last = null;
  for (let start = 0; start < str.length; start += step) {
    const verdict = await checkLearnerText(apiKey, str.slice(start, start + MODERATION_INPUT_CHARS), opts);
    last = verdict;
    if (verdict.blocked) return verdict;
    if (start + MODERATION_INPUT_CHARS >= str.length) break;
  }
  return last || {allowed: true, blocked: false, reason: "skipped", matchedCategories: [], flaggedCategories: [], skipped: true};
}

module.exports = {
  LEARNER_BLOCK_MESSAGE,
  moderationEnabled,
  failClosedOnError,
  moderateText,
  checkLearnerText,
  checkLearnerTextWindowed,
  MODERATION_INPUT_CHARS,
};
