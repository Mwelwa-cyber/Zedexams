/**
 * Pure assembly of the Anthropic `system` blocks for teacher-tool + quiz
 * generations. Kept dependency-free (no firebase-functions) so it can be unit
 * tested with plain `node` without installing the Cloud Functions deps.
 */

const {ZAMBIAN_CURRENCY_REFERENCE} = require("./zambianFacts");

// Block order matters for prompt-cache economics: caches hit on stable
// prefixes left-to-right. The system prompt never changes; neither does the
// Zambian-facts reference, so both sit at the front of the prefix and stay
// cached across every generation. The format block has only a few dozen
// variants (assessment type × grade band × subject); the CBC block varies per
// topic. Format-before-CBC means the system+facts+format prefix stays cached
// across requests for the same paper shape even when topics differ.
//
// The Zambian-facts block keeps the whole teacher-tool + quiz suite using the
// CURRENT currency (the 2025 Heritage series — K2/K5 are now coins, K200/K500
// are new notes) instead of the stale denominations baked into model training.
function buildSystemBlocks(systemPrompt, cbcContextBlock, formatContextBlock) {
  if (!systemPrompt) return undefined;
  return [
    {type: "text", text: systemPrompt, cache_control: {type: "ephemeral"}},
    {type: "text", text: ZAMBIAN_CURRENCY_REFERENCE, cache_control: {type: "ephemeral"}},
    ...(formatContextBlock ? [
      {type: "text", text: formatContextBlock, cache_control: {type: "ephemeral"}},
    ] : []),
    ...(cbcContextBlock ? [
      {type: "text", text: cbcContextBlock, cache_control: {type: "ephemeral"}},
    ] : []),
  ];
}

module.exports = {buildSystemBlocks};
