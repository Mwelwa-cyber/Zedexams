/**
 * Node test for the character-billed text-to-speech pricing in
 * aiCostTracking.js. Run: node functions/aiCostTts.test.js
 *
 * Google Cloud TTS spend historically never reached ANY rollup — there was no
 * price table for it, so /admin/ai-costs and the Treasury month-to-date
 * ceiling were both blind to the one surface a learner can trigger directly.
 * These assertions pin:
 *   - the tier lookup, which is a SEGMENT match (the tier sits in the middle
 *     of a Google voice name), not the longest-prefix match the token and
 *     image tables use
 *   - the 40× Standard→Studio spread, since mispricing here is the expensive
 *     kind of wrong
 *   - the unknown-voice zero-cost fallback (count the call, don't fabricate)
 *   - recordAiTtsUsage's rollup writes via a stubbed Firestore, including the
 *     character counter that carries the unit this spend is billed in
 *   - that adding `characters` did not disturb the token/image callers
 */

const assert = require("node:assert");
const admin = require("firebase-admin");

const {
  ttsVoiceTier,
  ttsCostUsd,
  recordAiTtsUsage,
  recordAiUsage,
  TTS_PRICE_PER_MCHAR,
} = require("./aiCostTracking");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const near = (a, b) => Math.abs(a - b) < 1e-12;

console.log("aiCostTts");

// ── ttsVoiceTier: the tier is a middle segment, not a prefix ───────────────
ok("en-GB-Neural2-A → neural2", ttsVoiceTier("en-GB-Neural2-A") === "neural2");
ok("en-GB-Studio-B → studio", ttsVoiceTier("en-GB-Studio-B") === "studio");
ok("en-ZA-Standard-A → standard", ttsVoiceTier("en-ZA-Standard-A") === "standard");
ok("en-US-Wavenet-D → wavenet", ttsVoiceTier("en-US-Wavenet-D") === "wavenet");
ok("tier lookup is case-insensitive", ttsVoiceTier("EN-GB-NEURAL2-A") === "neural2");
ok("a voice with no known tier → null", ttsVoiceTier("en-GB-Chirp3-HD-Aoede") === null);
ok("empty / missing voice → null", ttsVoiceTier("") === null && ttsVoiceTier(undefined) === null);

// Every voice tts.js is willing to synthesise must price. A voice the endpoint
// accepts but the table cannot price is spend that silently records as $0 —
// exactly the blindness this table exists to end. Mirrors ALLOWED_VOICES.
const ALLOWED_VOICES = [
  "en-GB-Neural2-A", "en-GB-Neural2-B",
  "en-US-Neural2-F", "en-US-Neural2-J",
  "en-ZA-Standard-A", "en-ZA-Standard-B",
  "en-GB-Standard-A",
  "en-GB-Studio-B", "en-GB-Studio-C",
];
ok("every voice apiTextToSpeech accepts resolves to a priced tier",
  ALLOWED_VOICES.every((v) => ttsVoiceTier(v) !== null));

// ── ttsCostUsd: per-million-character rates ───────────────────────────────
ok("1M Neural2 characters → $16", near(ttsCostUsd("en-GB-Neural2-A", 1_000_000), 16.00));
ok("1M Standard characters → $4", near(ttsCostUsd("en-ZA-Standard-A", 1_000_000), 4.00));
ok("1M Studio characters → $160", near(ttsCostUsd("en-GB-Studio-B", 1_000_000), 160.00));

// The spread is why tier resolution has to be right: pricing a Studio voice as
// Standard under-reports by 40×.
ok("Studio costs 40× Standard for the same text",
  near(ttsCostUsd("en-GB-Studio-B", 5000), ttsCostUsd("en-ZA-Standard-A", 5000) * 40));

// The endpoint's own MAX_CHARS cap, at the priciest tier — the per-request
// worst case the burst limiter (10/min/user) multiplies.
ok("one 3000-char Studio request → $0.48", near(ttsCostUsd("en-GB-Studio-B", 3000), 0.48));

// ── ttsCostUsd: never fabricate ───────────────────────────────────────────
ok("unknown voice → $0 even for a large body",
  ttsCostUsd("elevenlabs-rachel", 1_000_000) === 0);
ok("zero characters → $0", ttsCostUsd("en-GB-Studio-B", 0) === 0);
ok("negative characters → $0", ttsCostUsd("en-GB-Studio-B", -500) === 0);
ok("non-numeric characters → $0", ttsCostUsd("en-GB-Studio-B", "lots") === 0);
ok("the table is rates-per-million, not per-character",
  TTS_PRICE_PER_MCHAR.studio === 160.00 && TTS_PRICE_PER_MCHAR.standard === 4.00);

// ── rollup writes via a stubbed Firestore ─────────────────────────────────
// Same defineProperty stub as aiCostProviders.test.js (admin.firestore is a
// non-writable namespace getter). Captures every set() with its doc path.
function stubFirestoreCapture() {
  const writes = [];
  const makeDoc = (path) => ({
    set: async (data, opts) => writes.push({path, data, opts}),
    get: async () => ({exists: true, data: () => ({totalCostUsd: 0})}),
    collection: (name) => makeColl(`${path}/${name}`),
  });
  const makeColl = (path) => ({
    doc: (id) => makeDoc(`${path}/${id}`),
    get: async () => ({forEach: () => {}, docs: []}),
  });
  const fs = () => ({collection: (name) => makeColl(name)});
  fs.FieldValue = {
    increment: (n) => ({__inc: n}),
    serverTimestamp: () => ({__ts: true}),
  };
  Object.defineProperty(admin, "firestore", {configurable: true, value: fs});
  return writes;
}

(async () => {
  {
    const writes = stubFirestoreCapture();
    const res = await recordAiTtsUsage({
      uid: "learner1",
      voice: "en-GB-Neural2-A",
      characters: 2000,
      tool: "tts",
    });
    ok("recordAiTtsUsage returns the character cost",
      res && near(res.costUsd, 0.032) && res.characters === 2000);
    ok("TTS records no tokens — there are none",
      res.inputTokens === 0 && res.outputTokens === 0);

    const day = writes.find((w) => /^aiUsage\/\d{4}-\d{2}-\d{2}\/shards\/\d+$/.test(w.path));
    ok("TTS spend lands on the daily rollup shard",
      day && near(day.data.totalCostUsd.__inc, 0.032) && day.data.callCount.__inc === 1);
    ok("the daily shard carries the character volume",
      day.data.totalCharacters.__inc === 2000);

    // The month doc is what the Treasury ceiling reads. TTS being absent from
    // it was half the blindness — the dashboard could have been fixed alone
    // and the budget gate would still have under-counted.
    const month = writes.find((w) => /^aiUsageMonthly\/[\d-]+\/shards\/\d+$/.test(w.path));
    ok("TTS spend reaches the monthly rollup the budget ceiling reads",
      month && near(month.data.totalCostUsd.__inc, 0.032) &&
      month.data.totalCharacters.__inc === 2000);

    ok("TTS spend attributes to the learner and to a 'tts' tool row",
      writes.some((w) => w.path.endsWith("/users/learner1")) &&
      writes.some((w) => /\/toolShards\/tts__\d+$/.test(w.path)));
  }

  {
    // An unpriceable voice must still COUNT — a call with no cost row is a gap
    // to notice in the tool rollup, not a call to drop on the floor.
    const writes = stubFirestoreCapture();
    const res = await recordAiTtsUsage({
      uid: "learner2", voice: "en-GB-Chirp3-HD-Aoede", characters: 900, tool: "tts",
    });
    ok("unpriced voice records $0 but is still counted with its volume",
      res && res.costUsd === 0 && res.characters === 900);
    const day = writes.find((w) => /\/shards\/\d+$/.test(w.path));
    ok("the unpriced call still increments callCount", day.data.callCount.__inc === 1);
  }

  {
    // Regression guard on the shared writer: adding `characters` must not have
    // changed what a token caller records.
    const writes = stubFirestoreCapture();
    const res = await recordAiUsage({
      uid: "teacher1",
      model: "claude-haiku-4-5-20251001",
      usage: {input_tokens: 1000, output_tokens: 500},
      tool: "verifyQuiz",
    });
    ok("token callers still record their tokens and cost",
      res && res.inputTokens === 1000 && res.outputTokens === 500 && res.costUsd > 0);
    const day = writes.find((w) => /^aiUsage\/\d{4}-\d{2}-\d{2}\/shards\/\d+$/.test(w.path));
    ok("a token call increments characters by 0, not by undefined",
      day.data.totalCharacters.__inc === 0);
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
