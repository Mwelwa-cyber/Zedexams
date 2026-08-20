import { apiUrl } from './runtime';
import { ttsAuthHeaders } from './ttsAuth';

const TTS_ENDPOINT = '/api/tts';

let currentAudio = null;
let currentUrl   = null;

function stripMarkdown(text = '') {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch synthesised audio and return an object URL the CALLER owns.
 *
 * Split out of `speak()` so a caller that plays the same short text over and
 * over can hold the result instead of re-requesting it. That is not a cost
 * optimisation — /api/tts already caches server-side — it is a QUOTA one: a
 * cache hit still spends one of a learner's 60 daily AI calls, deliberately
 * (see the note in functions/tts.js), so the only way to make a replay free
 * for the learner is not to make the request. The spelling round is the
 * caller this exists for.
 *
 * Returns null when there is no usable session or the endpoint refused —
 * both of which mean "use the browser voice", never "fail".
 *
 * OWNERSHIP: the returned URL is NOT revoked here. Whoever asks for it is
 * responsible for `URL.revokeObjectURL` when they are finished with it;
 * `speak()` below revokes its own.
 */
export async function fetchSpeechUrl(rawText, options = {}) {
  const text = stripMarkdown(rawText);
  if (!text) return null;
  const { voice = '', rate = 1.0, pitch = 0 } = options;
  const headers = await ttsAuthHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(apiUrl(TTS_ENDPOINT), {
      method:  'POST',
      headers,
      body:    JSON.stringify({ text, ...(voice ? { voice } : {}), rate, pitch }),
    });
    if (!res.ok) throw new Error(`Cloud TTS ${res.status}`);
    return URL.createObjectURL(await res.blob());
  } catch (err) {
    console.warn('[tts] cloud failed', err?.message);
    return null;
  }
}

export async function speak(rawText, options = {}) {
  const text = stripMarkdown(rawText);
  if (!text) return;
  stopSpeaking();
  // `voice` is deliberately un-defaulted: /api/tts resolves the learner's voice
  // from the admin's selection (settings/ttsVoices) when the request names
  // none. A hard-coded Google id here would 400 the moment an admin offers a
  // different set, and the catch below would hide that behind the browser voice.
  const { rate = 1.0 } = options;

  // No usable ID token, or the endpoint refused → read with the browser voice.
  // Routine when signed out (the public paper-quiz runner is reachable that
  // way), hence no warning of its own here.
  const url = await fetchSpeechUrl(rawText, options);
  if (!url) return speakBrowser(text, { rate });

  const audio = new Audio(url);
  currentAudio = audio;
  currentUrl   = url;
  return new Promise((resolve, reject) => {
    audio.onended = () => { cleanup(audio); resolve(); };
    audio.onerror = (e) => { cleanup(audio); reject(e); };
    audio.play().catch(reject);
  });
}

export function stopSpeaking() {
  if (currentAudio) { try { currentAudio.pause(); } catch {} cleanup(currentAudio); }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
}

export function isSpeaking() {
  if (currentAudio && !currentAudio.paused) return true;
  if (typeof window !== 'undefined' && window.speechSynthesis?.speaking) return true;
  return false;
}

function cleanup(audio) {
  if (currentAudio === audio) {
    currentAudio = null;
    if (currentUrl) { try { URL.revokeObjectURL(currentUrl); } catch {} currentUrl = null; }
  }
}

function speakBrowser(text, { rate = 1.0 } = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.reject(new Error('No TTS'));
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = (e) => reject(e);
    const voices = window.speechSynthesis.getVoices();
    const best = voices.find(v => /en[-_]GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
    if (best) u.voice = best;
    window.speechSynthesis.speak(u);
  });
}