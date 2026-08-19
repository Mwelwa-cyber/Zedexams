const { onRequest } = require('firebase-functions/v2/https');
const admin         = require('firebase-admin');
const { getUserRole, assertDailyLimit } = require('./aiService');
const { assertDecodedVerified } = require('./authGuard');
const { applyCors } = require('./cors');
const { guardHttpRateLimit } = require('./rateLimit');
const { softVerifyAppCheckHttp } = require('./appCheckHttp');
const { enforceJsonRequest } = require('./httpRequestGuard');

/**
 * The Text-to-Speech SDK and its client are built on FIRST SYNTHESIS, not at
 * module load.
 *
 * functions/index.js requires every module in the codebase, so a top-level
 * `require('@google-cloud/text-to-speech')` here was paid by all 196 exports —
 * 37.5 MiB of RSS and ~180 ms of cold start on a Lenco webhook, a Firestore
 * trigger, a quiz generation, everything — for a package exactly one HTTP
 * endpoint calls. Constructing the client at module scope compounded it: that
 * opens the gRPC/auth stack on load too.
 *
 * The client is cached across invocations, so a warm instance still reuses one
 * client exactly as before; only the FIRST synthesis on an instance pays the
 * load, and that request was already making a network round trip to Google.
 */
let _client = null;
function ttsClient() {
  if (!_client) {
    const textToSpeech = require('@google-cloud/text-to-speech');
    _client = new textToSpeech.TextToSpeechClient();
  }
  return _client;
}

const MAX_CHARS = 3000;
const ALLOWED_VOICES = new Set([
  'en-GB-Neural2-A', 'en-GB-Neural2-B',
  'en-US-Neural2-F', 'en-US-Neural2-J',
  'en-ZA-Standard-A', 'en-ZA-Standard-B',
  'en-GB-Standard-A',
  'en-GB-Studio-B', 'en-GB-Studio-C',
]);

function languageCodeFor(voice) {
  return voice.split('-').slice(0, 2).join('-');
}

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

    const { text, voice = 'en-GB-Neural2-A', rate = 1.0, pitch = 0 } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'Missing or empty text' });
    if (text.length > MAX_CHARS)
      return res.status(400).json({ error: `Text too long (max ${MAX_CHARS} chars)` });
    if (!ALLOWED_VOICES.has(voice))
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

    try {
      const [response] = await ttsClient().synthesizeSpeech({
        input: { text },
        voice: { languageCode: languageCodeFor(voice), name: voice },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate:  Math.min(Math.max(Number(rate)  || 1, 0.5),  1.5),
          pitch:         Math.min(Math.max(Number(pitch) || 0, -10),   10),
        },
      });
      // Record the spend BEFORE the response goes out.
      //
      // Google TTS bills per character, and this endpoint recorded nothing at
      // all — there was no TTS row in aiCostTracking's price tables, so
      // /admin/ai-costs and the Treasury month-to-date ceiling were both
      // blind to every character synthesised here. At the
      // 3000-char cap a single Studio request is ~$0.48, and the burst limiter
      // above allows 10/min per user — untracked, that is real money moving
      // with nothing to show it.
      //
      // Awaited rather than fired-and-forgotten: a v2 instance can be frozen
      // once the response is flushed, so work started after send() is not
      // guaranteed to finish, and an accounting write that usually lands is
      // worse than one that always does — it under-reports by an unknown
      // amount. recordAiTtsUsage swallows its own errors and returns null, so
      // this cannot fail the request; the cost is a few Firestore increments
      // against a call that already made a network round trip to Google.
      //
      // Required lazily for the same reason the TTS client is (see the note at
      // the top of this file): functions/index.js loads every module, and this
      // one pulls in treasury + reservation + sharded-counter machinery that
      // no other export on a cold instance needs.
      const {recordAiTtsUsage} = require('./aiCostTracking');
      await recordAiTtsUsage({
        uid:        decoded.uid,
        voice,
        characters: text.length,
        tool:       'tts',
      });

      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(response.audioContent);
    } catch (err) {
      // Log the real cause server-side; never forward the upstream/internal
      // exception text to the caller (it can leak provider/internal detail).
      console.error('[tts]', err?.message || err);
      return res.status(500).json({ error: 'TTS synthesis failed. Please try again.' });
    }
  }
);