const { onRequest } = require('firebase-functions/v2/https');
const textToSpeech  = require('@google-cloud/text-to-speech');

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

exports.apiTextToSpeech = onRequest(
  {
    region:         'us-central1',
    memory:         '256MiB',
    timeoutSeconds: 30,
    cors:           true,
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

    const { text, voice = 'en-GB-Neural2-A', rate = 1.0, pitch = 0 } = req.body || {};

    if (!text || typeof text !== 'string' || !text.trim())
      return res.status(400).json({ error: 'Missing or empty text' });
    if (text.length > MAX_CHARS)
      return res.status(400).json({ error: `Text too long (max ${MAX_CHARS} chars)` });
    if (!ALLOWED_VOICES.has(voice))
      return res.status(400).json({ error: `Voice '${voice}' not allowed` });

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
      console.error('[tts]', err?.message || err);
      return res.status(500).json({
        error:  'TTS synthesis failed',
        detail: String(err?.message || err).slice(0, 300),
      });
    }
  }
);