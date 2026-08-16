"use strict";

/**
 * contentModerationCore — pure decision logic for learner-facing content
 * moderation (production-readiness finding AI-003). No I/O, no firebase deps,
 * so it unit-tests under plain `node`. The network call to OpenAI's moderation
 * endpoint lives in contentModeration.js.
 *
 * ZedExams serves primary-age children (Grade 4–7), so the only guardrail on
 * learner AI input + model output was a system prompt (bypassable). This adds a
 * deterministic verdict layer on top of OpenAI's omni-moderation result.
 */

// Categories that BLOCK for a children's platform (fail-closed on a positive
// verdict). The remaining omni-moderation categories (harassment, hate,
// violence, illicit, self-harm without intent) are recorded but not blocked —
// they are frequently tripped by ordinary curriculum content (history of war,
// civic-education debate) and blocking them would be all false positives.
const DEFAULT_BLOCKED_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "harassment/threatening",
  "hate/threatening",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "violence/graphic",
  "illicit/violent",
];

/**
 * Turn an OpenAI moderation API response into a block/allow decision.
 *
 * @param {object} apiResult  The parsed `/v1/moderations` response
 *   ({ results: [{ flagged, categories, category_scores }] }).
 * @param {object} [opts]
 * @param {string[]} [opts.blockedCategories]  Categories that block (default DEFAULT_BLOCKED_CATEGORIES).
 * @returns {{flagged:boolean, blocked:boolean, matchedCategories:string[], flaggedCategories:string[]}}
 */
function evaluateModeration(apiResult, {blockedCategories = DEFAULT_BLOCKED_CATEGORIES} = {}) {
  const result = apiResult && Array.isArray(apiResult.results) ? apiResult.results[0] : null;
  if (!result || typeof result !== "object") {
    return {flagged: false, blocked: false, matchedCategories: [], flaggedCategories: []};
  }
  const categories = result.categories && typeof result.categories === "object" ? result.categories : {};
  // Every category the model flagged true (for logging/telemetry).
  const flaggedCategories = Object.keys(categories).filter((c) => categories[c] === true);
  // The subset that we actually block on.
  const blockSet = new Set(blockedCategories);
  const matchedCategories = flaggedCategories.filter((c) => blockSet.has(c));
  return {
    flagged: Boolean(result.flagged) || flaggedCategories.length > 0,
    blocked: matchedCategories.length > 0,
    matchedCategories,
    flaggedCategories,
  };
}

/**
 * Decide the final outcome for a piece of learner-facing content, folding in
 * the fail-open/fail-closed policy for a moderation SERVICE error (distinct
 * from a positive verdict, which always blocks).
 *
 * @param {object} args
 * @param {object|null} args.apiResult   Parsed moderation response, or null on error.
 * @param {boolean} [args.errored]       True if the moderation call itself failed.
 * @param {boolean} [args.failClosed]    On a service error, block (true) or allow (false, default).
 * @param {string[]} [args.blockedCategories]
 * @returns {{allowed:boolean, blocked:boolean, reason:'ok'|'flagged'|'service_error', matchedCategories:string[], flaggedCategories:string[]}}
 */
function decideContentOutcome({apiResult, errored = false, failClosed = false, blockedCategories} = {}) {
  if (errored || !apiResult) {
    // Service error: a positive verdict is unknown. Default fail-OPEN for
    // availability (the model's own safety + system prompt still apply); flip
    // to fail-closed via config where strictness must win over uptime.
    return {
      allowed: !failClosed,
      blocked: failClosed,
      reason: "service_error",
      matchedCategories: [],
      flaggedCategories: [],
    };
  }
  const verdict = evaluateModeration(apiResult, {blockedCategories});
  return {
    allowed: !verdict.blocked,
    blocked: verdict.blocked,
    reason: verdict.blocked ? "flagged" : "ok",
    matchedCategories: verdict.matchedCategories,
    flaggedCategories: verdict.flaggedCategories,
  };
}

/**
 * Describe a moderation SERVICE FAILURE as a log record, or return null when
 * the screen actually ran.
 *
 * This exists because the two fail-open defaults this codebase runs are not
 * equally observable, and the asymmetry was invisible. The burst rate limiter
 * fails open loudly — a structured `rate_limit_degraded` event plus
 * `rateLimitHealth.js`, a canary that turns that telemetry into an ops alert.
 * Moderation failed open with a bare `console.warn` naming the provider error,
 * and — the part that mattered — said nothing at all about the OUTCOME. A
 * learner message passing UNSCREENED produced no record distinguishable from
 * one that passed a clean screen.
 *
 * Two things made that unrecoverable rather than merely quiet:
 *
 *   • `functionErrorWatch` — since #2230 the ONLY thing watching server logs,
 *     because Sentry does not observe Cloud Functions — filters
 *     `severity>=ERROR`. A WARNING is not merely low-priority to it; it is
 *     invisible.
 *   • There is no moderation equivalent of the rate-limiter canary, so nothing
 *     probes the screen's health independently either.
 *
 * So the severity here is a deliberate decision, not a formatting choice:
 *
 *   fail-OPEN  → `error`. Unscreened learner content reached a child-facing
 *                surface. This is the case that must reach a human, and ERROR
 *                is the floor for being seen at all.
 *   fail-CLOSED→ `warn`. The learner was blocked, so safety held and only
 *                availability suffered. Real, but not a child-safety event.
 *
 * A single provider blip does not page: `functionErrorWatch` alerts the
 * non-OOM classes on a sustained rate across CONSECUTIVE windows, per function,
 * with a cooldown. Sustained degradation keeps saying so until it stops, which
 * is the behaviour this signal wants.
 *
 * **This does not change the fail-open default.** Whether an unreachable
 * provider should block a child's chat is a product decision with an
 * availability cost, and `MODERATION_FAIL_CLOSED` already exists to flip it.
 * What was missing was the ability to know it had happened.
 *
 * Pure: builds a record, writes nothing. The caller emits it.
 *
 * @param {object}  args
 * @param {object}  args.outcome  A `decideContentOutcome` result.
 * @param {string}  [args.label]  Call-site label, e.g. "aiChat:input".
 * @param {string}  [args.error]  Provider error message, already truncated.
 * @returns {{event:string, severity:'error'|'warn', unscreened:boolean, label:string, reason:string, error:string}|null}
 */
function describeModerationDegradation({outcome, label = "moderation", error = ""} = {}) {
  if (!outcome || outcome.reason !== "service_error") return null;
  const unscreened = outcome.allowed === true;
  return {
    event: "moderation_degraded",
    severity: unscreened ? "error" : "warn",
    unscreened,
    label,
    reason: outcome.reason,
    error: String(error || "").slice(0, 200),
  };
}

module.exports = {
  DEFAULT_BLOCKED_CATEGORIES,
  evaluateModeration,
  decideContentOutcome,
  describeModerationDegradation,
};
