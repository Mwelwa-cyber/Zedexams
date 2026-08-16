"use strict";

// Unit tests for functions/contentModerationCore.js (AI-003 decision logic).
// Plain `node`. Run: node functions/contentModerationCore.test.js

const assert = require("node:assert");
const {
  DEFAULT_BLOCKED_CATEGORIES,
  evaluateModeration,
  decideContentOutcome,
  describeModerationDegradation,
} = require("./contentModerationCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

// Helper to build a fake OpenAI moderation response.
function result({flagged = false, categories = {}}) {
  return {results: [{flagged, categories, category_scores: {}}]};
}

// ── DEFAULT_BLOCKED_CATEGORIES ────────────────────────────────────────────
{
  ok("blocks sexual/minors", DEFAULT_BLOCKED_CATEGORIES.includes("sexual/minors"));
  ok("blocks self-harm", DEFAULT_BLOCKED_CATEGORIES.includes("self-harm"));
  ok("blocks graphic violence", DEFAULT_BLOCKED_CATEGORIES.includes("violence/graphic"));
  ok("does NOT block bare 'violence' (curriculum: history of war)", !DEFAULT_BLOCKED_CATEGORIES.includes("violence"));
  ok("does NOT block bare 'hate' (civic debate)", !DEFAULT_BLOCKED_CATEGORIES.includes("hate"));
}

// ── evaluateModeration ────────────────────────────────────────────────────
{
  const clean = evaluateModeration(result({flagged: false, categories: {violence: false}}));
  ok("clean content not blocked", !clean.blocked && !clean.flagged);

  const unsafe = evaluateModeration(result({flagged: true, categories: {"sexual/minors": true}}));
  ok("blocked category blocks", unsafe.blocked);
  ok("matched category reported", unsafe.matchedCategories.includes("sexual/minors"));

  // A category that is flagged but NOT in the block set: recorded, not blocked.
  const softFlag = evaluateModeration(result({flagged: true, categories: {violence: true}}));
  ok("non-blocked flagged category is not blocked", !softFlag.blocked);
  ok("non-blocked flagged category still reported as flagged", softFlag.flagged);
  ok("flaggedCategories captures it", softFlag.flaggedCategories.includes("violence"));

  // Custom block set.
  const custom = evaluateModeration(result({flagged: true, categories: {violence: true}}), {blockedCategories: ["violence"]});
  ok("custom block set applies", custom.blocked);

  // Malformed inputs fail safe (not blocked, not crash).
  for (const bad of [null, undefined, {}, {results: []}, {results: [null]}, "nope"]) {
    const r = evaluateModeration(bad);
    ok(`malformed input (${JSON.stringify(bad)}) → safe default`, r.blocked === false && r.flagged === false);
  }
}

// ── decideContentOutcome ──────────────────────────────────────────────────
{
  const okOutcome = decideContentOutcome({apiResult: result({flagged: false, categories: {}})});
  ok("clean → allowed/ok", okOutcome.allowed && okOutcome.reason === "ok");

  const blockedOutcome = decideContentOutcome({apiResult: result({flagged: true, categories: {"self-harm": true}})});
  ok("unsafe verdict → blocked/flagged", blockedOutcome.blocked && blockedOutcome.reason === "flagged");
  ok("blocked outcome reports category", blockedOutcome.matchedCategories.includes("self-harm"));

  // Service error, default fail-OPEN.
  const errOpen = decideContentOutcome({apiResult: null, errored: true, failClosed: false});
  ok("service error fail-open → allowed", errOpen.allowed && errOpen.reason === "service_error");

  // Service error, fail-CLOSED.
  const errClosed = decideContentOutcome({apiResult: null, errored: true, failClosed: true});
  ok("service error fail-closed → blocked", errClosed.blocked && errClosed.reason === "service_error");

  // Missing apiResult without explicit errored flag is treated as a service error too.
  const missing = decideContentOutcome({apiResult: null});
  ok("missing result → service_error (fail-open default)", missing.allowed && missing.reason === "service_error");
}

// ── describeModerationDegradation ─────────────────────────────────────────
//
// The property under test is not "it logs" — it is that a fail-OPEN is
// distinguishable from a fail-CLOSED, and reaches ERROR. functionErrorWatch
// filters severity>=ERROR and is the only thing watching server logs, so a
// WARNING here is the same as silence.
{
  const failOpen = decideContentOutcome({apiResult: null, errored: true, failClosed: false});
  const open = describeModerationDegradation({outcome: failOpen, label: "aiChat:input", error: "moderation HTTP 503"});
  ok("fail-open is reported", open !== null);
  ok("fail-open is ERROR severity (a WARNING never reaches functionErrorWatch)", open.severity === "error");
  ok("fail-open records that the text was UNSCREENED", open.unscreened === true);
  ok("event name is greppable and stable", open.event === "moderation_degraded");
  ok("call-site label is carried", open.label === "aiChat:input");
  ok("provider error is carried", open.error === "moderation HTTP 503");

  const failClosed = decideContentOutcome({apiResult: null, errored: true, failClosed: true});
  const closed = describeModerationDegradation({outcome: failClosed, label: "aiChat:input"});
  ok("fail-closed is reported too", closed !== null);
  ok("fail-closed is WARN, not ERROR — safety held, only availability suffered", closed.severity === "warn");
  ok("fail-closed records that nothing passed unscreened", closed.unscreened === false);

  // CONTROL: the two cases must not collapse into one. A describe() that
  // returned a constant severity would pass every assertion above except this.
  ok("the two failure modes differ in severity", open.severity !== closed.severity);

  // A screen that actually RAN is not a degradation, in either direction.
  const clean = decideContentOutcome({apiResult: result({flagged: false, categories: {}})});
  ok("a clean screen reports nothing", describeModerationDegradation({outcome: clean}) === null);
  const blocked = decideContentOutcome({apiResult: result({flagged: true, categories: {"self-harm": true}})});
  ok("a BLOCKED verdict is not a degradation — the screen worked", describeModerationDegradation({outcome: blocked}) === null);

  // Defensive: never throw on a missing/!odd outcome, since the caller is on
  // the child-facing request path.
  ok("no outcome → null, not a throw", describeModerationDegradation({}) === null);
  ok("no args at all → null, not a throw", describeModerationDegradation() === null);

  // The error string is bounded — it lands in a log line, and a provider can
  // return an arbitrarily long body.
  const long = describeModerationDegradation({outcome: failOpen, error: "x".repeat(500)});
  ok("provider error is truncated to 200 chars", long.error.length === 200);
}

console.log(`All contentModerationCore tests passed (${passed} assertions).`);
