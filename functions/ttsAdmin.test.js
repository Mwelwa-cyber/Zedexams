/**
 * Node test for the ElevenLabs client + the admin TTS control room.
 * Run: node functions/ttsAdmin.test.js
 *
 * The three things pinned here are the ones that fail SILENTLY:
 *
 *   1. ElevenLabs spend must never record at $0 once a rate is configured, and
 *      must be REPORTED as unpriced while it is not. Deriving the rate from an
 *      opaque voice id the way Google's tier lookup works would price 100% of
 *      it at $0 — the same under-report the segment lookup exists to prevent,
 *      one provider later.
 *   2. The admin catalogue and the endpoint's ALLOWED_VOICES must agree. A
 *      voice in one and not the other is either a voice the admin can pick and
 *      the endpoint refuses, or one the endpoint serves and the admin cannot
 *      see priced.
 *   3. An unconfigured or unreachable provider must be a STATE, never a throw.
 *      The panel's job is to report that ElevenLabs is not connected; a panel
 *      that errors instead tells the operator nothing.
 */

const assert = require("node:assert");

const {
  ttsCostUsd,
  ttsRateUsdPerMchar,
  ttsRateStatus,
  elevenLabsUsdPerMchar,
  ELEVENLABS_RATE_ENV,
} = require("./aiCostTracking");
const el = require("./elevenLabsClient");
// ttsAdminCore, NOT ttsAdmin: this suite runs from the repo root, where
// firebase-functions does not resolve. Importing the onCall module here is
// what broke the Functions coverage job — the split is the fix.
const {GOOGLE_VOICES, googleCatalogue} = require("./ttsAdminCore");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const near = (a, b) => Math.abs(a - b) < 1e-12;

const ORIG_RATE = process.env[ELEVENLABS_RATE_ENV];
const ORIG_KEY = process.env.ELEVENLABS_API_KEY;
function setRate(v) {
  if (v === null) delete process.env[ELEVENLABS_RATE_ENV];
  else process.env[ELEVENLABS_RATE_ENV] = String(v);
}
function setKey(v) {
  if (v === null) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = String(v);
}

console.log("ttsAdmin");

// ── 1. ElevenLabs pricing is CONFIGURED, and its absence is reported ───────
setRate(null);
ok("with no rate configured, ElevenLabs prices at $0 (never invented)",
  ttsCostUsd("21m00Tcm4TlvDq8ikWAM", 1_000_000, "elevenlabs") === 0);
ok("...and that $0 is REPORTED as unpriced, not passed off as free",
  ttsRateStatus().elevenlabs.priced === false);
ok("the unpriced note names the variable to set",
  ttsRateStatus().elevenlabs.note.includes(ELEVENLABS_RATE_ENV));
ok("an unset rate resolves to null, not 0",
  elevenLabsUsdPerMchar() === null && ttsRateUsdPerMchar("elevenlabs", "any") === null);

setRate(150);
ok("a configured rate prices an OPAQUE voice id",
  near(ttsCostUsd("21m00Tcm4TlvDq8ikWAM", 1_000_000, "elevenlabs"), 150));
ok("...and 3000 characters costs rate/333 as expected",
  near(ttsCostUsd("21m00Tcm4TlvDq8ikWAM", 3000, "elevenlabs"), 0.45));
ok("a configured rate reports as priced with its value",
  ttsRateStatus().elevenlabs.priced === true &&
  ttsRateStatus().elevenlabs.usdPerMchar === 150);

// The regression this file exists for: pricing an ElevenLabs voice through
// Google's voice-name tier lookup returns null for every real id.
ok("the Google tier lookup CANNOT price an ElevenLabs id — hence the provider arg",
  ttsRateUsdPerMchar("google", "21m00Tcm4TlvDq8ikWAM") === null);
ok("the same characters priced as google vs elevenlabs differ",
  ttsCostUsd("21m00Tcm4TlvDq8ikWAM", 3000, "google") !==
  ttsCostUsd("21m00Tcm4TlvDq8ikWAM", 3000, "elevenlabs"));

setRate(0);
ok("a zero or negative rate is treated as unset, not as free synthesis",
  elevenLabsUsdPerMchar() === null);
setRate(-5);
ok("a negative rate is refused too", elevenLabsUsdPerMchar() === null);
setRate("not-a-number");
ok("a non-numeric rate is refused", elevenLabsUsdPerMchar() === null);

// Google is unaffected by any of this.
setRate(null);
ok("Google voices still price by tier", near(ttsCostUsd("en-GB-Studio-B", 3000), 0.48));
ok("Google's default provider argument is unchanged",
  ttsCostUsd("en-GB-Neural2-A", 1_000_000) === ttsCostUsd("en-GB-Neural2-A", 1_000_000, "google"));

// ── 2. The admin catalogue matches what the endpoint will actually serve ───
{
  const src = require("node:fs").readFileSync(require.resolve("./tts.js"), "utf8");
  const block = src.match(/const ALLOWED_VOICES = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "could not find ALLOWED_VOICES in tts.js");
  const endpointVoices = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const adminVoices = GOOGLE_VOICES.map((v) => v.id).sort();
  ok("the admin catalogue lists exactly the voices the endpoint accepts",
    JSON.stringify(endpointVoices) === JSON.stringify(adminVoices));
}
{
  const cat = googleCatalogue();
  ok("every catalogue voice carries a tier and a rate",
    cat.length === GOOGLE_VOICES.length &&
    cat.every((v) => v.tier && typeof v.usdPerMchar === "number" && v.usdPerMchar > 0));
  ok("every catalogue voice is marked with its provider",
    cat.every((v) => v.provider === "google"));
  ok("the Studio voices are the expensive ones, as priced",
    cat.find((v) => v.id === "en-GB-Studio-B").usdPerMchar === 160 &&
    cat.find((v) => v.id === "en-ZA-Standard-A").usdPerMchar === 4);
}

// ── 3. An unconfigured provider is a state, never a throw ─────────────────
(async () => {
  setKey(null);
  ok("no key → isConfigured() false", el.isConfigured() === false);

  const sub = await el.getSubscription();
  ok("getSubscription reports unconfigured rather than throwing",
    sub.configured === false && sub.ok === false && typeof sub.error === "string");

  const voices = await el.listVoices();
  ok("listVoices reports unconfigured and returns an empty list",
    voices.configured === false && voices.ok === false && Array.isArray(voices.voices) &&
    voices.voices.length === 0);

  const synth = await el.synthesize({text: "hello", voiceId: "abc"});
  ok("synthesize reports unconfigured rather than throwing (Google is the fallback)",
    synth.ok === false && synth.configured === false);

  setKey("test-key");
  ok("a key present → isConfigured() true", el.isConfigured() === true);
  const bad = await el.synthesize({text: "", voiceId: ""});
  ok("synthesize refuses empty input without a network call",
    bad.ok === false && /required/i.test(bad.error));

  // Restore whatever the environment had.
  setRate(ORIG_RATE === undefined ? null : ORIG_RATE);
  setKey(ORIG_KEY === undefined ? null : ORIG_KEY);

  console.log(`\n─── ${passed} assertions · all passed ───`);
})();
