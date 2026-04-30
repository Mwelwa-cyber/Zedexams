import { apiUrl } from './runtime';

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

export async function speak(rawText, options = {}) {
  const text = stripMarkdown(rawText);
  if (!text) return;
  stopSpeaking();
  const { voice = 'en-GB-Neural2-A', rate = 1.0, pitch = 0 } = options;

  try {
    const res = await fetch(apiUrl(TTS_ENDPOINT), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, voice, rate, pitch }),
    });
    if (!res.ok) throw new Error(`Cloud TTS ${res.status}`);
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    currentUrl   = url;
    return new Promise((resolve, reject) => {
      audio.onended = () => { cleanup(audio); resolve(); };
      audio.onerror = (e) => { cleanup(audio); reject(e); };
      audio.play().catch(reject);
    });
  } catch (err) {
    console.warn('[tts] cloud failed, falling back to browser', err?.message);
    return speakBrowser(text, { rate });
  }
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