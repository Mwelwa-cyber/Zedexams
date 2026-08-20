/**
 * Saying a spelling word out loud — a three-tier ladder, best first.
 *
 *   1. A PRE-GENERATED file (`word.audio`). A static object voiced once by an
 *      admin through the ElevenLabs path. No quota, no rate limit, no cost per
 *      play, works signed out, and the service worker can hold it.
 *   2. LIVE `/api/tts` via `src/utils/tts.js`. The same endpoint every other
 *      learner surface reads through — so the voice is whatever an admin has
 *      offered in /admin/voice, ElevenLabs included, with the server-side
 *      cache and cost tracking that already exist.
 *   3. The BROWSER voice. Already inside `speak()`'s own catch, so a device
 *      with no network, no session, or no cloud voice still plays the round.
 *
 * ── Why tier 1 exists at all ──────────────────────────────────────────────
 * This file used to call `speechSynthesis` directly, which was wrong twice
 * over: it bypassed the TTS system this repo already had, and it meant every
 * learner heard the robotic device voice. Routing it straight at `/api/tts`
 * would have been wrong in the other direction — that endpoint allows 10
 * requests a minute and a learner gets 60 AI calls a DAY across every
 * surface, while one stage of eight words costs fifteen to twenty. Spelling
 * would have eaten a learner's whole daily allowance in three stages and then
 * degraded, silently, to the voice it was supposed to replace.
 *
 * A word is therefore voiced ONCE and stored. Tier 2 is what covers a word an
 * admin has not voiced yet, and the coach's chunks — nonsense fragments like
 * "sep" that appear only after a miss, and are not worth pre-generating.
 *
 * ── The in-session cache is a RATE control, not a cost one ────────────────
 * The server already caches synthesis, so a repeat is cheap for us. It is not
 * free for the LEARNER: a cache hit still spends one of their 60. So a word
 * fetched through tier 2 is held for the session, and "Hear it again" costs
 * nothing at all rather than costing a call that happens to be cheap.
 *
 * Nothing here throws and nothing blocks. A round must play when audio does
 * not.
 */

import { fetchSpeechUrl, speak as cloudSpeak, stopSpeaking } from '../../../utils/tts'

/**
 * Word → object URL for audio already fetched this session.
 *
 * Bounded: a learner who plays for an hour would otherwise hold an object URL
 * per distinct word for as long as the tab lives. The oldest entry is revoked
 * when the cap is passed, so the memory is returned rather than merely
 * forgotten — an un-revoked object URL is a leak the GC cannot collect.
 */
const played = new Map()
const MAX_CACHED = 64

function remember(key, url) {
  played.set(key, url)
  while (played.size > MAX_CACHED) {
    const oldest = played.keys().next().value
    const stale = played.get(oldest)
    played.delete(oldest)
    try { URL.revokeObjectURL(stale) } catch { /* already gone */ }
  }
}

/** Everything currently making noise, so `stopSpeech` can silence all of it. */
let currentAudio = null

/**
 * Is any playback possible at all?
 *
 * `window.Audio`, NOT `speechSynthesis` — and the difference is the point.
 * The old check gated the "Hear it" button on the browser's speech engine, so
 * a device without one (several Android WebViews, a locked-down browser) was
 * shown no button even though the cloud voice and a pre-generated file would
 * both have played perfectly. The button now appears wherever audio can play,
 * which is everywhere this app runs.
 */
export function speechAvailable() {
  return typeof window !== 'undefined' && typeof window.Audio === 'function'
}

/** Stop whatever is being said, by any tier. */
export function stopSpeech() {
  try {
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.currentTime = 0
      currentAudio = null
    }
  } catch { /* nothing to stop */ }
  // Covers both the cloud <Audio> element and the browser voice.
  try { stopSpeaking() } catch { /* nothing to stop */ }
}

/** Play a URL directly. Resolves false when it could not, never throws. */
async function playUrl(url) {
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') return false
  try {
    stopSpeech()
    const audio = new window.Audio(url)
    currentAudio = audio
    await audio.play()
    return true
  } catch {
    // Autoplay refusal, a 404 on a moved object, a decode failure. The caller
    // falls through to the next tier rather than the learner getting silence.
    currentAudio = null
    return false
  }
}

/**
 * Say a word.
 *
 * `audioUrl` is the pre-generated object when the content has one. It is
 * checked for shape before it reaches an `Audio` element: the field is
 * written by the pipeline but is editable by an admin, and "it came from our
 * own database" is not a reason to hand an arbitrary string to a media
 * element.
 */
export async function speakWord(word, { audioUrl = '', rate = 0.85 } = {}) {
  const text = String(word || '').trim()
  if (!text) return

  // Tier 1 — the pre-generated file.
  if (isPlayableAudioUrl(audioUrl) && await playUrl(audioUrl)) return

  // Tier 1b — anything already fetched this session, including through tier 2.
  const key = cacheKey(text, rate)
  const held = played.get(key)
  if (held && await playUrl(held)) return

  // Tier 2 — the cloud voice, fetched ONCE and held. LOWERCASED, always:
  // several voices spell an all-caps string out letter by letter, which would
  // read the answer aloud to a learner being asked to produce it. The tiles
  // are uppercase; what is spoken must not be.
  const spoken = text.toLowerCase()
  try {
    const url = await fetchSpeechUrl(spoken, { rate })
    if (url) {
      remember(key, url)
      if (await playUrl(url)) return
    }
  } catch { /* fall through to the browser voice */ }

  // Tier 3 — the browser voice. `speak()` reaches it through its own fallback
  // when the fetch returns nothing, which is also the signed-out path.
  try {
    await cloudSpeak(spoken, { rate })
  } catch { /* speech is a bonus, never a blocker */ }
}

/**
 * Say one chunk of a word — "sep", "a", "rate".
 *
 * Never pre-generated: a chunk is a fragment, it only appears after a miss on
 * one of the 79 authored cuts, and it is not worth an object each.
 *
 * The `rate` is passed through and MAY DO NOTHING. Google honours it;
 * ElevenLabs has no rate input and the server normalises it out of the cache
 * key so two rates cannot buy the same audio twice. Said here because a
 * reader would otherwise reasonably assume a chunk plays slower than a word
 * on every voice, and on the ElevenLabs voice it does not.
 */
export async function speakChunk(chunk) {
  return speakWord(chunk, { rate: 0.7 })
}

function cacheKey(text, rate) {
  return `${String(text).toLowerCase()}|${rate}`
}

/**
 * A URL safe to hand to an `Audio` element: https, and not absurd.
 *
 * Mirrors `isPlayableAudioUrl` in functions/spelling/spellingAudioCore.js —
 * the server refuses to write one that fails this, and the client refuses to
 * play one, because the two run on different sides of a field an admin can
 * type into.
 */
export function isPlayableAudioUrl(url) {
  const raw = String(url || '').trim()
  if (!raw || raw.length > 2048) return false
  return /^https:\/\//i.test(raw)
}
