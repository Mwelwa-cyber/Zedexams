/**
 * Per-model request shaping for the Anthropic Messages API.
 *
 * Newer Claude models reject request fields the older ones accept, and the
 * failure is a 400 on EVERY call, not a degraded answer:
 *
 *   - Sampling parameters. Sonnet 5, Opus 4.7+ and every 5-generation model
 *     refuse a non-default `temperature` / `top_p` / `top_k`. Nearly every call
 *     here sends one — `callClaude` alone defaults `temperature` to 0.3 — so
 *     pointing ANTHROPIC_MODEL at one of those models would fail every
 *     generator at once.
 *   - Thinking defaults. On Sonnet 5 a request that omits `thinking` runs
 *     ADAPTIVE thinking (Sonnet 4.x ran thinking-off). That is not an error,
 *     but it spends thinking tokens out of the same `max_tokens`, so a
 *     generator sized for a thinking-off model can truncate. Pinning
 *     `{type: "disabled"}` keeps the behaviour every caller was written for.
 *
 * This lives at the ONE place every Messages request passes through
 * (`anthropicFetch`), so a model can be switched with the ANTHROPIC_MODEL /
 * `*_MODEL` settings alone — no call site needs to know which models accept
 * what. A model this module does not recognise is sent exactly as the caller
 * built it: the policy only ever REMOVES a field a model is known to refuse,
 * or pins a default a model is known to have changed.
 *
 * Pure — no I/O, no firebase. Tests: functions/anthropicRequestPolicy.test.js.
 */

const SAMPLING_FIELDS = ["temperature", "top_p", "top_k"];

// claude-<family>-<major>[-<minor>][-<YYYYMMDD>]
const MODEL_ID = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

function parseModel(model) {
  const m = MODEL_ID.exec(String(model || "").trim());
  if (!m) return null;
  return {
    family: m[1],
    major: Number(m[2]),
    minor: m[3] === undefined ? 0 : Number(m[3]),
  };
}

/**
 * What a model accepts. Unknown ids get the permissive legacy answer, so the
 * body passes through unchanged.
 */
function requestPolicyFor(model) {
  const p = parseModel(model);
  if (!p) return {rejectsSampling: false, pinThinkingDisabled: false};
  const rejectsSampling =
    p.family === "fable" ||
    p.family === "mythos" ||
    p.major >= 5 ||
    (p.family === "opus" && p.major === 4 && p.minor >= 7);
  // Only the migration target this was written for. Other 5-generation models
  // differ (some refuse `disabled` outright), so they are left to the caller.
  const pinThinkingDisabled = p.family === "sonnet" && p.major === 5;
  return {rejectsSampling, pinThinkingDisabled};
}

/**
 * Returns `{body, changed}`. `body` is a new object when anything changed and
 * the caller's own object otherwise.
 */
function applyRequestPolicy(body) {
  if (!body || typeof body !== "object") return {body, changed: false};
  const policy = requestPolicyFor(body.model);
  let out = body;
  const edit = () => {
    if (out === body) out = {...body};
    return out;
  };
  if (policy.rejectsSampling) {
    for (const field of SAMPLING_FIELDS) {
      if (field in body) delete edit()[field];
    }
  }
  if (policy.pinThinkingDisabled && body.thinking === undefined) {
    edit().thinking = {type: "disabled"};
  }
  return {body: out, changed: out !== body};
}

module.exports = {applyRequestPolicy, requestPolicyFor, parseModel};
