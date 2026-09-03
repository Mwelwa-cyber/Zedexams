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
 * ── The secret binding, and the order it had to happen in ────────────────
 * ELEVENLABS_API_KEY is bound with defineSecret below, which is only safe
 * BECAUSE the secret already holds a value in Secret Manager. A defineSecret
 * bound to a valueless secret makes `firebase deploy` HARD-FAIL ("no value for
 * the secret: X") and blocks EVERY functions deploy in the project, not just
 * this one — the trap documented for RECRAFT_API_KEY in index.js. So the value
 * was stored first (`firebase functions:secrets:set ELEVENLABS_API_KEY`) and
 * the binding added second. If this secret is ever retired, delete the binding
 * and redeploy BEFORE destroying the secret, or the same deploy-wide failure
 * arrives from the other direction.
 *
 * The binding is UNCONDITIONAL, never gated on a process.env flag: deploy-time
 * analysis runs in a subprocess that never sees functions/.env, so a flag read
 * at module load is always undefined there and would silently bind nothing —
 * the #1983/#1991 failure, which passed CI and shipped because an unreferenced
 * secret is never validated.
 */

"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const {assertVerifiedAuth} = require("./authGuard");
const {assertCallableRateLimit} = require("./rateLimit");
const {getUserRole, isAdminRole} = require("./aiService");

// The catalogue and its pricing live in ttsAdminCore.js, which imports no
// firebase-functions — the functions node suite runs from the repo root where
// that package does not resolve, so anything a plain-node test loads has to
// stay clear of it. Same reason as every other *Core.js split here.
const {GOOGLE_VOICES, googleCatalogue} = require("./ttsAdminCore");

const elevenLabsApiKey = defineSecret("ELEVENLABS_API_KEY");

exports.getTtsControlRoom = onCall(
  {
    region: "us-central1",
    // 256MiB (the floor — see docs/architecture/13-cloud-functions-register.md's
    // measured 148MiB module-load cost) was getting OOM-killed here: unlike
    // previewTtsVoice/setTtsOfferedVoices, this handler fires TWO concurrent
    // ElevenLabs reads (getSubscription + listVoices, the latter returning the
    // whole voice catalogue) on top of that base, then assembles them with the
    // Google catalogue and the offered-voices config into one reply. 512MiB
    // matches the other admin/external-API callables with comparable per-request
    // work (generateSpellingAudio, familyPortal, parentPortal, platformMetrics).
    memory: "512MiB",
    timeoutSeconds: 30,
    secrets: [elevenLabsApiKey],
  },
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

    // The offered list as the ENDPOINT will resolve it — read through the
    // same module /api/tts uses, so the panel can never show a different
    // answer than the thing it is configuring.
    const voiceConfig = require("./ttsVoiceConfig");
    const {readVoiceConfigDoc, getEffectiveVoices} = voiceConfig;
    const configDoc = await readVoiceConfigDoc();
    const effective = await getEffectiveVoices();

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
      offered: {
        // `configured` distinguishes "an admin chose these" from "the
        // built-in defaults are standing in" — the UI words the two
        // differently, and only the first can be narrowed by unticking.
        configured: Boolean(configDoc),
        voices: effective,
      },
    };
  },
);

/**
 * setTtsOfferedVoices — write `settings/ttsVoices`, the endpoint allow-list.
 *
 * The list is validated by the same pure module the endpoint resolves with
 * (ttsVoiceConfigCore), and invalid entries are REPORTED back as `dropped`
 * rather than silently discarded — an admin who typo'd a voice id needs to
 * hear so, not to discover a voice quietly missing. An EMPTY list is allowed
 * and means "back to the built-in Google defaults": the endpoint treats an
 * empty offered list as unset, so there is no way to configure zero voices —
 * a product with a read-aloud button and no voice behind it is not a state
 * an admin can reach from here.
 */
// Handler only — the onCall builder lives in index.js, where the
// frozen-surface guard (test:functions-manifest) reads every new export's
// options. Delegated `exports.x = require(...)` builders may only shrink.
exports.setTtsOfferedVoicesHandler = async (request) => {
    await assertVerifiedAuth(request);
    await assertCallableRateLimit(request, {action: "setTtsOfferedVoices", userPerMin: 10});

    const role = await getUserRole(request.auth.uid);
    if (!isAdminRole(role)) {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const {normalizeOfferedList} = require("./ttsVoiceConfigCore");
    const {offered, dropped} = normalizeOfferedList(request.data?.voices);

    const admin = require("firebase-admin");
    await admin.firestore().doc("settings/ttsVoices").set({
      offered,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: request.auth.uid,
    });

    // The endpoint's in-memory copy refreshes within its 60s TTL; this
    // instance's own copy is reset now so the panel re-reads immediately.
    require("./ttsVoiceConfig")._resetVoiceConfigCache();

    return {saved: offered.length, dropped};
};

/**
 * previewTtsVoice — synthesise a SHORT text so an admin can audition a voice
 * before offering it to learners. This is the one place a voice that is NOT
 * on the offered list may be synthesised, because auditioning is the step
 * that decides whether it goes on the list.
 *
 * Spend controls, tightest first: admin-only, 6/min, 200 characters (a
 * Zambian place name or a spelling word, not a paragraph — at ElevenLabs'
 * $166.67/M a full-cap preview costs $0.033 and ~1,000 of them fit in the
 * monthly plan). It reads and writes the SHARED audio cache under the same
 * key scheme as /api/tts, so a repeated test of the same phrase is free and
 * anything auditioned is already cached for the first learner. Usage records
 * under its own `tts-preview` tool row — audition spend and learner spend
 * answer different questions on /admin/ai-costs.
 */
// Handler only — built in index.js (see setTtsOfferedVoicesHandler). The
// builder there binds its own defineSecret("ELEVENLABS_API_KEY") instance;
// duplicate defineSecret calls for one name are the accepted pattern
// (firestoreBackup.js and aiCostDailySummary.js share the SMTP pair).
exports.previewTtsVoiceHandler = async (request) => {
    await assertVerifiedAuth(request);
    await assertCallableRateLimit(request, {action: "previewTtsVoice", userPerMin: 6});

    const role = await getUserRole(request.auth.uid);
    if (!isAdminRole(role)) {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    const text = typeof request.data?.text === "string" ? request.data.text.trim() : "";
    if (!text) throw new HttpsError("invalid-argument", "text is required.");
    if (text.length > 200) {
      throw new HttpsError("invalid-argument", "Previews are capped at 200 characters.");
    }

    const {normalizeOfferedVoice} = require("./ttsVoiceConfigCore");
    const entry = normalizeOfferedVoice(request.data?.voice);
    if (!entry) throw new HttpsError("invalid-argument", "A valid voice {id, provider} is required.");

    const {ttsCacheKey} = require("./ttsCacheCore");
    const {readCachedAudio, writeCachedAudio} = require("./ttsCache");
    const {recordAiTtsUsage} = require("./aiCostTracking");
    const {synthesizeVoice, normalizedProsody} = require("./ttsSynthesis");

    const prosody = normalizedProsody(entry.provider, {});
    const cacheKey = ttsCacheKey({
      text, voice: entry.id, rate: prosody.rate, pitch: prosody.pitch,
      provider: entry.provider,
    });

    const cached = await readCachedAudio(cacheKey);
    if (cached) {
      await recordAiTtsUsage({
        uid: request.auth.uid, voice: entry.id, characters: text.length,
        tool: "tts-preview", cached: true, provider: entry.provider,
      });
      return {audioBase64: cached.toString("base64"), cached: true};
    }

    const synth = await synthesizeVoice({text, entry});
    if (!synth.ok) {
      // The admin is diagnosing; unlike the learner endpoint, the real
      // reason is useful here and leaks nothing the panel doesn't show.
      throw new HttpsError("unavailable", synth.error || "Synthesis failed.");
    }

    await recordAiTtsUsage({
      uid: request.auth.uid, voice: entry.id, characters: text.length,
      tool: "tts-preview", provider: entry.provider,
    });
    await writeCachedAudio(cacheKey, synth.audio, {
      voice: entry.id, characters: text.length, provider: entry.provider,
    });

    return {audioBase64: synth.audio.toString("base64"), cached: false};
};

// Re-exported so the callable module remains the single import site for
// callers that already have it; the tests import ttsAdminCore directly.
exports.GOOGLE_VOICES = GOOGLE_VOICES;
exports.googleCatalogue = googleCatalogue;
