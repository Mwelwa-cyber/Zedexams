/**
 * getTtsControlRoom — the admin TTS panel's one data call.
 *
 * ── What belongs here, and what deliberately does not ─────────────────────
 * This callable does ONLY what the browser cannot: talk to ElevenLabs. Spend
 * history is not in the reply, because /admin/ai-costs already reads the
 * aiUsage rollups straight from Firestore under admin rules — routing that
 * through a callable would add a second path to the same numbers and a second
 * way for them to disagree.
 *
 * So the reply is three things the client has no other source for:
 *   1. whether each provider is actually reachable,
 *   2. ElevenLabs' OWN credit position — authoritative in a way our rollups
 *      cannot be, since ours only see what this deploy spent, not what was
 *      spent from the dashboard, another key, or a test script,
 *   3. the voice catalogue, with what each voice costs.
 *
 * ── The key never reaches the browser ─────────────────────────────────────
 * That is the whole reason this is a callable rather than a fetch from the
 * admin page. An ElevenLabs key in a bundle is public, and "auto-disable if
 * leaked" would not save it — that detects keys committed to public repos, not
 * keys served in JavaScript.
 *
 * ── Why no defineSecret() ─────────────────────────────────────────────────
 * ELEVENLABS_API_KEY is read from process.env and NOT bound with
 * defineSecret, following functions/analyticsPurge.js. A defineSecret bound to
 * a function whose secret has no value in Secret Manager makes `firebase
 * deploy` HARD-FAIL and blocks EVERY functions deploy. Binding it before the
 * key is bought would wedge deploys for the whole repo. Configure
 * ELEVENLABS_API_KEY in functions/.env.<project> (or add the binding once the
 * secret genuinely exists) and this lights up; leave it unset and the panel
 * honestly reports "not connected".
 */

"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {assertCallableRateLimit} = require("./rateLimit");
const {getUserRole, isAdminRole} = require("./aiService");

// The Google voices the endpoint will synthesise, with what each costs. This
// mirrors ALLOWED_VOICES in tts.js — test:tts-admin fails if the two drift,
// because a voice offered by one and unknown to the other is either a voice
// the admin cannot see or a request the endpoint refuses.
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

/** The Google half of the catalogue, priced. Pure — exported for the tests. */
function googleCatalogue() {
  const {ttsVoiceTier, ttsRateUsdPerMchar} = require("./aiCostTracking");
  return GOOGLE_VOICES.map((v) => ({
    ...v,
    provider: "google",
    tier: ttsVoiceTier(v.id),
    usdPerMchar: ttsRateUsdPerMchar("google", v.id),
  }));
}

exports.getTtsControlRoom = onCall(
  {region: "us-central1", memory: "256MiB", timeoutSeconds: 30},
  async (request) => {
    await assertVerifiedAuth(request);
    await assertCallableRateLimit(request, {action: "getTtsControlRoom", userPerMin: 20});

    const role = await getUserRole(request.auth.uid);
    if (!isAdminRole(role)) {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const {ttsRateStatus} = require("./aiCostTracking");
    const el = require("./elevenLabsClient");

    // Both ElevenLabs reads run concurrently and NEITHER can fail the call:
    // the panel's job is to report the provider's state, so an unreachable
    // provider must render as "unreachable", not as a broken admin page.
    const [subscription, voices] = await Promise.all([
      el.getSubscription(),
      el.listVoices(),
    ]);

    return {
      rates: ttsRateStatus(),
      providers: {
        google: {
          available: true,
          // Google TTS authenticates with the function's own service account,
          // so there is no key to be missing — it is available wherever the
          // functions run.
          note: "Application default credentials; no API key to configure.",
        },
        elevenlabs: {
          configured: el.isConfigured(),
          reachable: Boolean(subscription.ok),
          tier: subscription.tier || null,
          charactersUsed: subscription.charactersUsed ?? null,
          characterLimit: subscription.characterLimit ?? null,
          charactersRemaining: subscription.charactersRemaining ?? null,
          resetsAt: subscription.resetsAt ?? null,
          error: subscription.ok ? null : (subscription.error || null),
        },
      },
      voices: {
        google: googleCatalogue(),
        elevenlabs: voices.ok ? voices.voices : [],
        elevenlabsError: voices.ok ? null : (voices.error || null),
      },
    };
  },
);

exports.GOOGLE_VOICES = GOOGLE_VOICES;
exports.googleCatalogue = googleCatalogue;
