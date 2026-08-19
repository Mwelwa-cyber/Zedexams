/**
 * Pure half of the admin TTS control room — the voice catalogue and its
 * pricing, with NO firebase-functions import.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * The `Tests (Functions coverage)` job runs the functions node suite from the
 * REPO ROOT, where `firebase-admin` resolves but `firebase-functions` does
 * not — it is only in functions/package.json. So any module a plain-node test
 * loads must not reach firebase-functions at module scope, which is the
 * documented reason for every other *Core.js split in this directory
 * (metaWhatsAppCore, googlePlayBillingCore, opsHeartbeatCore …).
 *
 * ttsAdmin.js keeps the onCall wrapper and the guards; everything testable
 * lives here.
 */

"use strict";

// The Google voices the endpoint will synthesise. This mirrors ALLOWED_VOICES
// in tts.js and test:tts-admin fails if the two drift, because a voice in one
// and not the other is either a voice the admin can pick and the endpoint
// refuses, or one the endpoint serves and the admin cannot see priced.
const GOOGLE_VOICES = [
  {id: "en-GB-Neural2-A", label: "British Female (Neural)", lang: "en-GB"},
  {id: "en-GB-Neural2-B", label: "British Male (Neural)", lang: "en-GB"},
  {id: "en-ZA-Standard-A", label: "South African Female", lang: "en-ZA"},
  {id: "en-ZA-Standard-B", label: "South African Male", lang: "en-ZA"},
  {id: "en-GB-Studio-B", label: "British Male (Studio HQ)", lang: "en-GB"},
  {id: "en-GB-Studio-C", label: "British Female (Studio HQ)", lang: "en-GB"},
  {id: "en-US-Neural2-F", label: "American Female (Neural)", lang: "en-US"},
  {id: "en-US-Neural2-J", label: "American Male (Neural)", lang: "en-US"},
  {id: "en-GB-Standard-A", label: "British (Standard)", lang: "en-GB"},
];

/** The Google half of the catalogue, priced by tier. */
function googleCatalogue() {
  const {ttsVoiceTier, ttsRateUsdPerMchar} = require("./aiCostTracking");
  return GOOGLE_VOICES.map((v) => ({
    ...v,
    provider: "google",
    tier: ttsVoiceTier(v.id),
    usdPerMchar: ttsRateUsdPerMchar("google", v.id),
  }));
}

module.exports = {GOOGLE_VOICES, googleCatalogue};
