/**
 * functions/aiValidation/responseParser.js
 *
 * The shared, hardened JSON-parsing layer for AI responses (Prompt 14 §5).
 * Pure — no firebase-admin / firebase-functions imports — so it runs under
 * plain `node functions/aiValidation/responseParser.test.js`.
 *
 * Why this exists: the codebase has several ad-hoc parsers
 * (aiService.stripJsonFences / tryRecoverTruncatedJson / parseGeneratedQuiz,
 * plus per-runner JSON.parse calls). They each re-solve "strip the fence,
 * recover the truncation, notice the refusal" slightly differently. This is the
 * single place that:
 *
 *   - strips markdown code fences and leading/trailing prose commentary,
 *   - detects provider refusals ("I can't help with that…") BEFORE trying to
 *     parse them as JSON,
 *   - detects truncation EXPLICITLY (§5) — an unclosed object/array, a
 *     stop_reason of "max_tokens"/"length", or a declared item count that the
 *     returned array doesn't reach — and never treats a truncated response as
 *     complete,
 *   - offers a CONTROLLED, opt-in best-effort recovery of a truncated array
 *     (kept behind `allowTruncationRecovery`, and always followed by strict
 *     downstream schema validation — the recovery flag never means "trust it"),
 *   - returns a STRUCTURED result ({ok, value, status, issues, ...}) instead of
 *     throwing, so the acceptance-state machine (validationResult.js) drives
 *     what happens next.
 *
 * It does NOT know any studio's schema — it produces a parsed value + parse-time
 * issues; per-operation schema/curriculum/safety validators run afterwards.
 */

const {issue} = require("./validationResult");

// Anthropic/OpenAI finish reasons that mean "output was cut off", not "done".
const TRUNCATION_STOP_REASONS = new Set(["max_tokens", "length", "model_length"]);

// Heuristic refusal openers. A provider refusal is short prose, never JSON, so
// a positive match here means "don't even try to parse this as content".
const REFUSAL_PATTERNS = [
  /\bI(?:'m| am) (?:sorry|unable|not able)\b/i,
  /\bI (?:can(?:'|no)t|cannot|won'?t) (?:help|assist|comply|provide|create|generate)\b/i,
  /\bI (?:must|have to) (?:decline|refuse)\b/i,
  /\bas an AI (?:language )?model\b/i,
  /\bI(?:'m| am) not able to (?:help|assist|provide)\b/i,
];

const DEFAULT_MAX_BYTES = 1_500_000; // §26 — reject absurd payloads up front.

function byteLength(str) {
  return typeof str === "string" ? Buffer.byteLength(str, "utf8") : 0;
}

/**
 * Strip markdown code fences AND any leading/trailing prose the model wrapped
 * around the JSON. Conservative: if there's a fenced block we take its contents;
 * otherwise we trim to the outermost bracket pair. Returns "" for empty input.
 */
function stripToJson(raw) {
  if (typeof raw !== "string") return "";
  let text = raw.trim();
  if (!text) return "";

  // 1. Prefer an explicit ```json … ``` (or bare ``` … ```) fence.
  const fence = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1] && fence[1].trim()) {
    text = fence[1].trim();
  }

  // 2. Trim leading/trailing commentary to the outermost { … } / [ … ] pair.
  //    Note: this is a bracket-position trim, not "substring extraction as the
  //    parse" — the result is still handed to JSON.parse, which rejects it if
  //    the trimmed span isn't valid JSON. (§5 warns against slice-only parsing;
  //    here the slice is a pre-clean, never the validation.)
  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  // No bracket anywhere → there is no JSON object/array to extract. Return ""
  // so the caller reports NO_JSON_FOUND rather than handing prose to JSON.parse
  // (which would mislabel "no JSON here" as "malformed JSON").
  if (!starts.length) return "";
  const start = Math.min(...starts);
  const lastObj = text.lastIndexOf("}");
  const lastArr = text.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end > start) text = text.slice(start, end + 1);
  else text = text.slice(start);
  return text.trim();
}

/**
 * Scan a JSON-ish string tracking string/escape state and bracket depth.
 * Returns {balanced, openBraces, openBrackets, sawJson}. `balanced` is true
 * only when every { and [ closed. Used for explicit truncation detection —
 * a well-formed-but-cut-off object leaves openBraces > 0.
 */
function scanBrackets(text) {
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  let sawJson = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { openBraces += 1; sawJson = true; continue; }
    if (ch === "[") { openBrackets += 1; sawJson = true; continue; }
    if (ch === "}") { openBraces -= 1; continue; }
    if (ch === "]") { openBrackets -= 1; continue; }
  }
  return {
    balanced: openBraces === 0 && openBrackets === 0 && !inString,
    openBraces,
    openBrackets,
    inString,
    sawJson,
  };
}

/**
 * Best-effort recovery of a truncated JSON payload: walk to the last point
 * where a top-level array element closed cleanly, slice there, and close the
 * still-open frames. Returns the parsed value or null. This is the CONTROLLED
 * fallback §5 permits — its output must still pass schema validation, and the
 * `truncated` flag stays set so the caller knows items may be missing.
 */
function recoverTruncatedJson(text) {
  if (!text || typeof text !== "string") return null;
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;
  let lastSafe = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { openBraces += 1; continue; }
    if (ch === "[") { openBrackets += 1; continue; }
    if (ch === "}") {
      openBraces -= 1;
      // An array element (depth: one outer object + its array) just closed,
      // or the top-level object closed.
      if (openBraces === 1 && openBrackets === 1) lastSafe = i;
      if (openBraces === 0 && openBrackets === 0) lastSafe = i;
      continue;
    }
    if (ch === "]") {
      openBrackets -= 1;
      if (openBraces === 1 && openBrackets === 0) lastSafe = i;
      continue;
    }
  }
  if (lastSafe < 0) return null;
  let truncated = text.slice(0, lastSafe + 1);

  // Recompute open frames at the cut and close them in LIFO order.
  let inStr2 = false;
  let esc2 = false;
  const closeStack = [];
  for (let i = 0; i < truncated.length; i += 1) {
    const ch = truncated[i];
    if (inStr2) {
      if (esc2) esc2 = false;
      else if (ch === "\\") esc2 = true;
      else if (ch === '"') inStr2 = false;
      continue;
    }
    if (ch === '"') { inStr2 = true; continue; }
    if (ch === "{") { closeStack.push("}"); continue; }
    if (ch === "[") { closeStack.push("]"); continue; }
    if (ch === "}" || ch === "]") { closeStack.pop(); continue; }
  }
  while (closeStack.length) truncated += closeStack.pop();
  try {
    return JSON.parse(truncated);
  } catch {
    return null;
  }
}

/** Does the (stripped) text look like a provider refusal rather than content? */
function looksLikeRefusal(text) {
  if (typeof text !== "string") return false;
  const head = text.trim().slice(0, 400);
  if (!head) return false;
  // A genuine JSON payload starts with a bracket; refusals are prose.
  if (/^[[{]/.test(head)) return false;
  return REFUSAL_PATTERNS.some((re) => re.test(head));
}

/**
 * Parse an AI response into a structured result. Never throws for a bad
 * response — returns {ok:false, ...issues} so the pipeline stays in control.
 *
 * @param {Object} args
 * @param {string} [args.raw]            The provider's text output.
 * @param {Object} [args.parsed]         A pre-parsed value (tool/structured-output
 *        callers already hold the object — pass it here to skip text parsing but
 *        still get refusal/size/count checks. `raw` may still be passed for the
 *        stop-reason/size context.)
 * @param {string|null} [args.stopReason]  Provider finish reason.
 * @param {number|null} [args.declaredCount]  A count the model claimed (e.g.
 *        "totalQuestions"); when the returned array is shorter → truncation.
 * @param {(v:any)=>number|null} [args.countItems]  Extracts the actual item
 *        count from a parsed value, compared against declaredCount.
 * @param {boolean} [args.allowTruncationRecovery=false]  Opt in to the
 *        best-effort array recovery. Even when it succeeds, `truncated` stays true.
 * @param {number} [args.maxBytes]       Reject a raw payload larger than this (§26).
 * @returns {{ok:boolean, value:*, status:string, truncated:boolean,
 *            refusal:boolean, recovered:boolean, issues:Array}}
 */
function parseAiJsonResponse({
  raw = "",
  parsed = undefined,
  stopReason = null,
  declaredCount = null,
  countItems = null,
  allowTruncationRecovery = false,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const issues = [];
  const stopTruncated = TRUNCATION_STOP_REASONS.has(String(stopReason || "").toLowerCase());

  // ── Size guard (§26) — before any parse, so we never load an absurd blob.
  const size = byteLength(raw);
  if (size > maxBytes) {
    issues.push(issue({
      path: "(root)",
      code: "RESPONSE_TOO_LARGE",
      message: `Response is ${size} bytes, over the ${maxBytes}-byte limit.`,
      severity: "critical",
      repairable: false,
    }));
    return {ok: false, value: null, status: "rejected", truncated: false, refusal: false, recovered: false, issues};
  }

  // ── Structured-output fast path: caller already has the object.
  if (parsed !== undefined && parsed !== null) {
    if (typeof parsed !== "object") {
      issues.push(issue({
        path: "(root)", code: "NOT_AN_OBJECT",
        message: "Structured output was not an object/array.",
        severity: "critical",
      }));
      return {ok: false, value: null, status: "rejected", truncated: false, refusal: false, recovered: false, issues};
    }
    const truncated = checkDeclaredCount(parsed, declaredCount, countItems, issues) || stopTruncated;
    if (stopTruncated) {
      issues.push(issue({
        path: "(root)", code: "TRUNCATED_STOP_REASON",
        message: `Provider finish reason "${stopReason}" indicates the output was cut off.`,
        severity: "error", repairable: true,
      }));
    }
    return {
      ok: !truncated,
      value: parsed,
      status: truncated ? "requires_review" : "parsed",
      truncated,
      refusal: false,
      recovered: false,
      issues,
    };
  }

  // ── Empty response.
  if (typeof raw !== "string" || !raw.trim()) {
    issues.push(issue({
      path: "(root)", code: "EMPTY_RESPONSE",
      message: "The AI returned an empty response.",
      severity: "critical",
    }));
    return {ok: false, value: null, status: "failed", truncated: stopTruncated, refusal: false, recovered: false, issues};
  }

  // ── Refusal detection (before parsing prose as JSON).
  if (looksLikeRefusal(raw)) {
    issues.push(issue({
      path: "(root)", code: "PROVIDER_REFUSAL",
      message: "The AI declined the request instead of returning content.",
      severity: "critical",
    }));
    return {ok: false, value: null, status: "rejected", truncated: false, refusal: true, recovered: false, issues};
  }

  const cleaned = stripToJson(raw);
  if (!cleaned) {
    issues.push(issue({
      path: "(root)", code: "NO_JSON_FOUND",
      message: "No JSON object or array found in the response.",
      severity: "critical",
    }));
    return {ok: false, value: null, status: "failed", truncated: stopTruncated, refusal: false, recovered: false, issues};
  }

  // ── Explicit truncation signal from bracket balance (§5).
  const scan = scanBrackets(cleaned);
  const bracketTruncated = scan.sawJson && !scan.balanced;

  // ── Strict parse first.
  let value = null;
  let recovered = false;
  try {
    value = JSON.parse(cleaned);
  } catch (parseErr) {
    // Malformed OR truncated. Try controlled recovery only when allowed AND the
    // bracket scan says it's a truncation (not random garbage).
    if (allowTruncationRecovery && (bracketTruncated || stopTruncated)) {
      const rec = recoverTruncatedJson(cleaned);
      if (rec && typeof rec === "object") {
        value = rec;
        recovered = true;
      }
    }
    if (value === null) {
      issues.push(issue({
        path: "(root)", code: bracketTruncated || stopTruncated ? "TRUNCATED_JSON" : "INVALID_JSON",
        message: `JSON.parse failed: ${String(parseErr && parseErr.message || parseErr).slice(0, 160)}`,
        severity: "critical",
        repairable: bracketTruncated || stopTruncated,
      }));
      return {
        ok: false, value: null,
        status: bracketTruncated || stopTruncated ? "requires_review" : "failed",
        truncated: bracketTruncated || stopTruncated, refusal: false, recovered: false, issues,
      };
    }
  }

  if (typeof value !== "object" || value === null) {
    issues.push(issue({
      path: "(root)", code: "NOT_AN_OBJECT",
      message: "Parsed JSON was not an object or array.",
      severity: "critical",
    }));
    return {ok: false, value: null, status: "rejected", truncated: false, refusal: false, recovered: false, issues};
  }

  // ── Truncation flags (§5): stop reason, unbalanced brackets, or a declared
  //    count the array didn't reach. Any one of them means "not complete".
  const countTruncated = checkDeclaredCount(value, declaredCount, countItems, issues);
  const truncated = Boolean(stopTruncated || bracketTruncated || recovered || countTruncated);

  if (stopTruncated) {
    issues.push(issue({
      path: "(root)", code: "TRUNCATED_STOP_REASON",
      message: `Provider finish reason "${stopReason}" indicates the output was cut off.`,
      severity: "error", repairable: true,
    }));
  }
  if (recovered) {
    issues.push(issue({
      path: "(root)", code: "TRUNCATION_RECOVERED",
      message: "Response was truncated; recovered the complete items only — later items may be missing.",
      severity: "error", repairable: true,
    }));
  }

  return {
    ok: !truncated,
    value,
    status: truncated ? "requires_review" : "parsed",
    truncated,
    refusal: false,
    recovered,
    issues,
  };
}

/**
 * Compare a model-declared item count against the actual array length and push
 * a warning issue on a shortfall. Returns true if the response is short of what
 * it claimed (a truncation signal). No-op when either side is unavailable.
 */
function checkDeclaredCount(value, declaredCount, countItems, issues) {
  if (!Number.isFinite(declaredCount) || declaredCount <= 0) return false;
  if (typeof countItems !== "function") return false;
  let actual;
  try {
    actual = countItems(value);
  } catch {
    return false;
  }
  if (!Number.isFinite(actual)) return false;
  if (actual < declaredCount) {
    issues.push(issue({
      path: "(root)", code: "DECLARED_COUNT_SHORTFALL",
      message: `Model declared ${declaredCount} items but returned ${actual}.`,
      severity: "error", repairable: true,
    }));
    return true;
  }
  return false;
}

module.exports = {
  TRUNCATION_STOP_REASONS,
  DEFAULT_MAX_BYTES,
  stripToJson,
  scanBrackets,
  recoverTruncatedJson,
  looksLikeRefusal,
  parseAiJsonResponse,
  checkDeclaredCount,
};
