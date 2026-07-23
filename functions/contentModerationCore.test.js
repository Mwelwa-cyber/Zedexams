"use strict";

// Unit tests for functions/contentModerationCore.js (AI-003 decision logic).
// Plain `node`. Run: node functions/contentModerationCore.test.js

const assert = require("node:assert");
const {
  DEFAULT_BLOCKED_CATEGORIES,
  evaluateModeration,
  decideContentOutcome,
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

console.log(`All contentModerationCore tests passed (${passed} assertions).`);
