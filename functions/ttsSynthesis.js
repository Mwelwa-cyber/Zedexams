/**
 * ONE synthesis path for every TTS caller — /api/tts serving a learner and
 * the admin preview callable auditioning a voice. Two call sites, one
 * provider branch: this file exists so voice routing cannot fork the way the
 * export rules once did (the #1977 lesson, one layer down).
 *
 * ── Providers ─────────────────────────────────────────────────────────────
 * `google` — Cloud TTS, authenticated by the runtime's own service account.
 *   rate/pitch are real synthesis inputs here.
 * `elevenlabs` — REST via elevenLabsClient, keyed by ELEVENLABS_API_KEY.
 *   rate/pitch are IGNORED: the API does not take them, so two requests
 *   differing only in rate are the same audio. Callers must normalise them
 *   out of cache keys for this provider (normalizedProsody below) or the
 *   shared cache fragments into identical copies bought twice.
 *
 * ── Failure contract ──────────────────────────────────────────────────────
 * Returns {ok:false, error} rather than throwing, and NEVER silently falls
 * back to the other provider. A learner who was promised one voice must not
 * hear another with nothing saying so (that is the "setting does nothing"
 * bug), and a Google-rendered body stored under an ElevenLabs cache key
 * would poison the shared cache for everyone after them. The HTTP client
 * already falls back to the browser voice on any non-OK — that is the
 * honest degradation path.
 *
 * The Google SDK + client are built on FIRST synthesis, not at module load:
 * functions/index.js requires every module, and the 37.5 MiB / ~180 ms this
 * package costs was previously paid by all ~200 exports (see the note this
 * moved from in tts.js).
 */

"use strict";

let _googleClient = null;
function googleClient() {
  if (!_googleClient) {
    const textToSpeech = require("@google-cloud/text-to-speech");
    _googleClient = new textToSpeech.TextToSpeechClient();
  }
  return _googleClient;
}

function languageCodeFor(voice) {
  return voice.split("-").slice(0, 2).join("-");
}

/** Clamped rate/pitch as the GOOGLE synthesiser will actually use them. */
function clampProsody({rate, pitch} = {}) {
  return {
    rate: Math.min(Math.max(Number(rate) || 1, 0.5), 1.5),
    pitch: Math.min(Math.max(Number(pitch) || 0, -10), 10),
  };
}

/**
 * The prosody a CACHE KEY should carry for a provider. ElevenLabs ignores
 * rate/pitch, so they are normalised to the defaults — otherwise a learner
 * on slow playback buys a second copy of byte-identical audio.
 */
function normalizedProsody(provider, {rate, pitch} = {}) {
  if (provider === "elevenlabs") return {rate: 1, pitch: 0};
  return clampProsody({rate, pitch});
}

/**
 * Synthesise `text` with an OFFERED voice entry ({id, provider}).
 *
 * @returns {Promise<{ok: boolean, audio?: Buffer, error?: string}>}
 */
async function synthesizeVoice({text, entry, rate, pitch}) {
  if (!text || !entry?.id) return {ok: false, error: "text and voice are required."};

  if (entry.provider === "elevenlabs") {
    const el = require("./elevenLabsClient");
    const r = await el.synthesize({text, voiceId: entry.id});
    if (!r.ok) return {ok: false, error: r.error || "ElevenLabs synthesis failed."};
    return {ok: true, audio: r.audio};
  }

  // Google (the default provider, and the fallback the ALLOW-LIST resolves
  // to — never a fallback synthesis takes on its own).
  try {
    const p = clampProsody({rate, pitch});
    const [response] = await googleClient().synthesizeSpeech({
      input: {text},
      voice: {languageCode: languageCodeFor(entry.id), name: entry.id},
      audioConfig: {audioEncoding: "MP3", speakingRate: p.rate, pitch: p.pitch},
    });
    const audio = response?.audioContent;
    if (!audio || !audio.length) return {ok: false, error: "Empty audio reply."};
    return {ok: true, audio: Buffer.isBuffer(audio) ? audio : Buffer.from(audio)};
  } catch (err) {
    // Log the real cause; never forward provider/internal detail to a caller.
    console.error("[ttsSynthesis] google", err?.message || err);
    return {ok: false, error: "Synthesis failed."};
  }
}

module.exports = {synthesizeVoice, normalizedProsody, clampProsody, languageCodeFor};
