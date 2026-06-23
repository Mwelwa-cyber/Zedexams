/**
 * Guards the authoritative Zambian currency reference and its injection into
 * every Claude-backed teacher/quiz generation.
 *
 * Run: npm run test:zambian-facts  (plain node, throws on failure)
 */

const assert = require("assert");
const {
  ZAMBIAN_CURRENCY_REFERENCE,
  ZAMBIAN_FACTS_VERSION,
} = require("./zambianFacts");

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("zambianFacts:");

check("reference lists the new high-value banknotes K200 and K500", () => {
  assert.ok(/K200/.test(ZAMBIAN_CURRENCY_REFERENCE), "missing K200");
  assert.ok(/K500/.test(ZAMBIAN_CURRENCY_REFERENCE), "missing K500");
});

check("reference states K2 and K5 are now coins, not notes", () => {
  assert.ok(
    /K2 and K5 are now COINS/.test(ZAMBIAN_CURRENCY_REFERENCE),
    "must declare K2/K5 as coins",
  );
});

check("reference does NOT describe a K2 or K5 banknote as current", () => {
  // The withdrawn-denominations note legitimately mentions the old notes, but
  // the reference must never assert a current "K2 note"/"K5 note".
  assert.ok(!/K2 note/i.test(ZAMBIAN_CURRENCY_REFERENCE), "found a 'K2 note'");
  assert.ok(!/K5 note/i.test(ZAMBIAN_CURRENCY_REFERENCE), "found a 'K5 note'");
});

check("reference keeps the kwacha/ngwee subunit and ZMW code", () => {
  assert.ok(/100 ngwee/.test(ZAMBIAN_CURRENCY_REFERENCE), "missing ngwee subunit");
  assert.ok(/ZMW/.test(ZAMBIAN_CURRENCY_REFERENCE), "missing ISO code");
});

check("reference is tagged with the current 2025 Heritage series", () => {
  assert.ok(/Heritage/.test(ZAMBIAN_CURRENCY_REFERENCE), "missing Heritage series");
  assert.ok(/2025/.test(ZAMBIAN_CURRENCY_REFERENCE), "missing launch year");
  assert.ok(
    /^zambian_facts\./.test(ZAMBIAN_FACTS_VERSION),
    "version tag must be namespaced",
  );
});

check("buildSystemBlocks injects the currency reference into the system prompt", () => {
  const {buildSystemBlocks} = require("./systemBlocks");
  const blocks = buildSystemBlocks("SYS", null, null);
  assert.ok(Array.isArray(blocks), "expected an array of system blocks");
  const texts = blocks.map((b) => b.text);
  assert.ok(texts.includes("SYS"), "system prompt block missing");
  assert.ok(
    texts.includes(ZAMBIAN_CURRENCY_REFERENCE),
    "currency reference is not injected into every generation",
  );
  // It must sit right after the system prompt so the cached prefix stays stable.
  assert.equal(blocks[0].text, "SYS");
  assert.equal(blocks[1].text, ZAMBIAN_CURRENCY_REFERENCE);
  assert.deepEqual(
    blocks[1].cache_control, {type: "ephemeral"},
    "currency reference must be a cached block",
  );
});

console.log(`\nzambianFacts: ${passed} checks passed.`);
