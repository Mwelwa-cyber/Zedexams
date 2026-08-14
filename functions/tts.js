const { onRequest } = require('firebase-functions/v2/https');
const admin         = require('firebase-admin');
const textToSpeech  = require('@google-cloud/text-to-speech');
const { getUserRole, assertDailyLimit } = require('./aiService');
const { assertDecodedVerified } = require('./authGuard');
const { applyCors } = require('./cors');
const { guardHttpRateLimit } = require('./rateLimit');
const { softVerifyAppCheckHttp } = require('./appCheckHttp');
const { enforceJsonRequest } = require('./httpRequestGuard');

const client = new textToSpeech.TextToSpeechClient();

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
      const [response] = await client.synthesizeSpeech({
        input: { text },
        voice: { languageCode: languageCodeFor(voice), name: voice },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate:  Math.min(Math.max(Number(rate)  || 1, 0.5),  1.5),
          pitch:         Math.min(Math.max(Number(pitch) || 0, -10),   10),
        },
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