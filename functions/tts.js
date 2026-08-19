const { onRequest } = require('firebase-functions/v2/https');
const admin         = require('firebase-admin');
const { getUserRole, assertDailyLimit } = require('./aiService');
const { assertDecodedVerified } = require('./authGuard');
const { applyCors } = require('./cors');
const { guardHttpRateLimit } = require('./rateLimit');
const { softVerifyAppCheckHttp } = require('./appCheckHttp');
const { enforceJsonRequest } = require('./httpRequestGuard');

const MAX_CHARS = 3000;

// The allow-list is CONFIG now, not code. `settings/ttsVoices` (written from
// /admin/voice) decides which voices this endpoint will synthesise; with no
// config it resolves to the built-in Google defaults in ttsAdminCore's
// GOOGLE_VOICES. The list is a FINANCIAL control — an open endpoint at Studio
// or ElevenLabs rates is a money printer for whoever finds it — so resolution
// fails toward the safe defaults, never toward "allow anything"
// (functions/ttsVoiceConfig.js, cached 60s off the request path).
//
// ELEVENLABS_API_KEY is bound here because an offered ElevenLabs voice makes
// THIS endpoint the caller. Safe to bind only because the secret already
// holds a value in Secret Manager — a defineSecret bound to a valueless
// secret hard-fails every functions deploy (the RECRAFT_API_KEY trap). The
// binding is unconditional; a flag read at deploy analysis time is always
// undefined and silently binds nothing (#1983/#1991).
const {defineSecret} = require('firebase-functions/params');
const elevenLabsApiKey = defineSecret('ELEVENLABS_API_KEY');

async function verifyIdToken(req) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try { return await admin.auth().verifyIdToken(token); }
  catch { return null; }
}

exports.apiTextToSpeech = onRequest(
  {
    region:         'us-central1',
    memory:         '256MiB',
    timeoutSeconds: 30,
    secrets:        [elevenLabsApiKey],
  },
  async (req, res) => {
    // Browser CORS via the shared origin allow-list (functions/cors.js).
    // Replaces v2 `cors:true`, which reflected ANY origin.
    applyCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

    // Declared Content-Type + body cap (SECURITY_ENDPOINT_AUDIT §4.5), before
    // the ID-token verification round-trip. The client (src/hooks/useSpeech.js)
    // sends application/json.
    if (enforceJsonRequest(req, res, { label: 'apiTextToSpeech' })) return;

    // Gate synthesis behind a valid Firebase ID token. Studio voices cost
    // ~$160/1M chars; an unauthenticated endpoint is a financial-DoS surface.
    const decoded = await verifyIdToken(req);
    if (!decoded) return res.status(401).json({ error: 'Sign in required.' });
    // Same financial-DoS reasoning applies to unverified throwaway accounts
    // (grace-window holders pass — assertDecodedVerified checks it).
    try { await assertDecodedVerified(decoded); } catch {
      return res.status(403).json({ error: 'Please verify your email address to continue.' });
    }

    // App Check observability + opt-in enforcement gate (SECURITY_ENDPOINT_AUDIT
    // §4.2). Studio voices are the priciest per-call surface in the project, so
    // this is the endpoint that most wants attestation — but it is also the one
    // that can least afford a botched flip, hence the same graduated rollout
    // every other surface uses: observe-only by default, enforced per-label via
    // APPCHECK_ENFORCE_LABELS, globally via APPCHECK_ENFORCE=1.
    //
    // Sits AFTER auth so an unauthenticated caller still gets 401 rather than a
    // 403 that misreports why it was refused, and BEFORE the rate limiter and
    // the daily meter so an unattested client is turned away before it can
    // consume either budget. The siblings let this HttpsError propagate to a
    // shared mapper; this endpoint answers in its own JSON shape, so it is
    // translated here rather than leaking a callable-shaped error to the wire.
    try {
      await softVerifyAppCheckHttp(req, 'apiTextToSpeech');
    } catch {
      return res.status(403).json({ error: 'App Check verification failed.' });
    }

    const { text, voice = '', rate = 1.0, pitch = 0 } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'Missing or empty text' });
    if (text.length > MAX_CHARS)
      return res.status(400).json({ error: `Text too long (max ${MAX_CHARS} chars)` });
    // Resolves id → {id, provider} against the offered list, refusing what
    // is not on it. The entry's provider drives synthesis routing below.
    // A request naming NO voice gets the first offered one — the default is
    // a property of the LIST, not a hard-coded id, so an admin narrowing the
    // list can never strand voice-less requests on a voice they removed.
    const {getEffectiveVoices} = require('./ttsVoiceConfig');
    const offeredVoices = await getEffectiveVoices();
    const voiceEntry = voice
      ? offeredVoices.find((v) => v.id === voice) || null
      : offeredVoices[0] || null;
    if (!voiceEntry)
      return res.status(400).json({ error: `Voice '${voice}' not allowed` });

    // Per-user + per-IP burst cap (fail-open). Studio TTS is the priciest
    // per-call surface, so hold the per-user window tighter than the shared
    // default. Sits in front of the daily quota so a loop is rejected with a
    // 429 before we call Google TTS.
    if (await guardHttpRateLimit(req, res, {
      action: 'tts', uid: decoded.uid, userPerMin: 10,
    })) return;

    // Per-user daily quota. Auth alone is not enough — a signed-in user
    // could otherwise call Studio TTS (~$160/1M chars, 3000/req) in an
    // unbounded loop (financial DoS). Shares the same aiDailyLimits/{uid}_{day}
    // budget as chat/explain/etc. (house helper). Fail-closed: if the
    // meter can't be checked we refuse rather than synthesise uncapped.
    try {
      const role = await getUserRole(decoded.uid);
      await assertDailyLimit(decoded.uid, role, 'tts');
    } catch (err) {
      if (err && err.code === 'resource-exhausted') {
        return res.status(429).json({
          error: 'Daily voice limit reached. Please try again tomorrow.',
        });
      }
      console.error('[tts] metering error', err?.message || err);
      return res.status(503).json({ error: 'Voice is temporarily unavailable.' });
    }

    // ── Cache lookup ──────────────────────────────────────────────────
    //
    // Synthesis is billed per character, and the two learner surfaces that
    // matter repeat heavily ACROSS users: a pronunciation is a short phrase
    // thousands of learners ask for, and a study note is one long body read
    // by everyone in the grade. Uncached, identical audio is bought once per
    // learner per playback. The cache is content-addressed and shared, so the
    // second listener onwards is free.
    //
    // It sits AFTER the rate limiter and the daily meter on purpose. Those
    // two are fairness and abuse controls, not merely cost controls — letting
    // a cached request skip them would hand anyone an unmetered endpoint that
    // just happens to be cheap for us to serve, and would make a learner's
    // remaining quota depend on whether a stranger had already asked for the
    // same sentence, which is impossible to explain.
    //
    // Everything below degrades to a miss on failure: a cache that is down
    // must cost money and work, never be free and broken.
    //
    // All three are required lazily for the same reason the TTS client is (see
    // the note at the top of this file): functions/index.js loads every module,
    // and aiCostTracking alone pulls in treasury + reservation + sharded-counter
    // machinery that no other export on a cold instance needs.
    const {ttsCacheKey} = require('./ttsCacheCore');
    const {readCachedAudio, writeCachedAudio} = require('./ttsCache');
    const {recordAiTtsUsage} = require('./aiCostTracking');
    const {synthesizeVoice, normalizedProsody} = require('./ttsSynthesis');
    // Prosody is normalised PER PROVIDER before keying: ElevenLabs ignores
    // rate/pitch, so keying them would buy byte-identical audio once per
    // playback speed (see ttsSynthesis.normalizedProsody).
    const prosody = normalizedProsody(voiceEntry.provider, {rate, pitch});
    const cacheKey = ttsCacheKey({
      text, voice: voiceEntry.id, rate: prosody.rate, pitch: prosody.pitch,
      provider: voiceEntry.provider,
    });

    const cached = await readCachedAudio(cacheKey);
    if (cached) {
      // Recorded at zero cost but WITH its characters, so the dashboard can
      // price what the cache saved instead of the saving being a claim.
      await recordAiTtsUsage({
        uid:        decoded.uid,
        voice:      voiceEntry.id,
        characters: text.length,
        tool:       'tts-cache-hit',
        cached:     true,
        provider:   voiceEntry.provider,
      });
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('X-Tts-Cache', 'hit');
      return res.status(200).send(cached);
    }

    try {
      // One provider branch for every caller (ttsSynthesis.js). On failure it
      // reports rather than falling back to the other provider — a learner
      // promised one voice must not silently hear another, and a Google body
      // under an ElevenLabs cache key would poison the shared cache. The
      // browser client already degrades to the device voice on any non-OK.
      const synth = await synthesizeVoice({text, entry: voiceEntry, rate, pitch});
      if (!synth.ok) {
        console.error('[tts] synthesis failed', voiceEntry.provider, synth.error);
        return res.status(502).json({ error: 'Voice is temporarily unavailable.' });
      }
      const response = {audioContent: synth.audio};
      // Record the spend BEFORE the response goes out. Google TTS bills per
      // character and this endpoint recorded nothing at all, so /admin/ai-costs
      // and the Treasury month-to-date ceiling were both blind to it: at the
      // 3000-char cap one Studio request is ~$0.48 and the limiter above allows
      // 10/min per user. Awaited for the freeze reason given below; it cannot
      // fail the request, since recordAiTtsUsage swallows its own errors.
      await recordAiTtsUsage({
        uid:        decoded.uid,
        voice:      voiceEntry.id,
        characters: text.length,
        tool:       'tts',
        provider:   voiceEntry.provider,
      });

      // Store for the next listener. Awaited for the same reason as the usage
      // write — a v2 instance can be frozen once the response is flushed, and
      // a cache whose writes only sometimes land only sometimes saves money.
      // The cost falls on the FIRST listener of a text, on a request that has
      // already spent seconds at Google, and is repaid by everyone after them.
      // writeCachedAudio never throws; a failed store is a future miss.
      await writeCachedAudio(cacheKey, response.audioContent, {
        voice: voiceEntry.id, characters: text.length, provider: voiceEntry.provider,
      });

      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('X-Tts-Cache', 'miss');
      return res.status(200).send(response.audioContent);
    } catch (err) {
      // Log the real cause server-side; never forward the upstream/internal
      // exception text to the caller (it can leak provider/internal detail).
      console.error('[tts]', err?.message || err);
      return res.status(500).json({ error: 'TTS synthesis failed. Please try again.' });
    }
  }
);