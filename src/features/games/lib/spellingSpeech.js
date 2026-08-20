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
 * ── TWO LEGS DELIBERATELY STAY ON THE DEVICE VOICE ────────────────────────
 * Spelling Ride added a spoken CORRECTION ("necessary… n, e, c, e, s, s, a,
 * r, y") and a gap-fill SENTENCE read, and neither goes up the ladder. That
 * is the same quota arithmetic that put tier 1 there in the first place:
 *
 *   • The correction fires on every wrong letter. A learner having a bad ride
 *     triggers it a dozen times in three minutes, and it is a letter-by-letter
 *     drill — the one piece of content where a flat, evenly-spaced robotic
 *     read is arguably BETTER than a natural one.
 *   • A Word Choice run reads about twelve sentences. Through tier 2 that is a
 *     fifth of a learner's daily allowance for one round, and the sentence is
 *     already on screen to be read.
 *
 * The WORD itself — the thing actually being learned, and the only thing a
 * Dictation learner is given — goes up the full ladder and gets the good
 * voice. That split is the whole point; do not "tidy" these two onto
 * `speakWord`.
 *
 * ── The accent order, which governs tier 3 ────────────────────────────────
 * A BRITISH-FORMS ENGLISH, ALWAYS. ECZ marks British spelling, and a US voice
 * says "zee" for the letter Z and reads "practise" as "practice". Within that
 * rule the accent is ordered: en-ZA first, then en-GB, then the other African
 * and Commonwealth Englishes, and only then en-US. A Zambian learner has heard
 * a South African accent all their life and a Midwestern one on television;
 * the first is easier to spell along with. This used to be `lang = 'en-GB'`
 * and no voice choice at all, which left the pick to the device — and a device
 * with one US voice installed ignored the tag entirely. `resolveVoice` makes
 * it a decision rather than a hint, and a device with no English voice at all
 * still falls through to whatever it has rather than going silent.
 *
 * Nothing here throws and nothing blocks. A round must play when audio does
 * not.
 */

import { fetchSpeechUrl, speak as cloudSpeak, stopSpeaking } from '../../../utils/tts'
import { resolveVoice } from './spellingVoiceCore'

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

/**
 * Is the BROWSER voice usable — tier 3, and the only thing the correction and
 * the sentence read have. Separate from `speechAvailable` because they answer
 * different questions: this one can be false on a device where the ladder
 * still plays every word perfectly.
 */
export function deviceSpeechAvailable() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function'
}

/**
 * The accent order and the picker live in `spellingVoiceCore.js`, which has no
 * imports at all — this module reaches Firebase through `utils/tts`, so the one
 * piece of it a plain-`node` guard can read had to sit outside it. Re-exported
 * here so every existing importer keeps one place to ask.
 */
export { VOICE_PREFERENCE, resolveVoice } from './spellingVoiceCore'

/** The chosen voice, resolved once and re-resolved when the device list lands. */
let chosen = null
let primed = false

function deviceVoices() {
  try {
    return deviceSpeechAvailable() ? (window.speechSynthesis.getVoices() || []) : []
  } catch { return [] }
}

/** The voice to speak with, re-resolved until the device has published a list. */
export function currentVoice() {
  if (chosen) return chosen
  chosen = resolveVoice(deviceVoices())
  return chosen
}

/**
 * Wake speech up inside a real user tap.
 *
 * iOS and several Android WebViews refuse to speak at all unless the first
 * utterance was started from a genuine user gesture, and the failure is
 * silent — the game looks like it has no voice. Called from the tap that
 * chooses a mode, which is the last gesture before a word is spoken.
 */
export function primeSpeech() {
  if (primed || !deviceSpeechAvailable()) return
  primed = true
  try {
    chosen = resolveVoice(deviceVoices())
    const warmUp = new window.SpeechSynthesisUtterance(' ')
    warmUp.volume = 0
    window.speechSynthesis.speak(warmUp)
    // The list often arrives AFTER the first call on Chrome and Android, so
    // the pick is redone once it does rather than being frozen as null.
    window.speechSynthesis.onvoiceschanged = () => { chosen = resolveVoice(deviceVoices()) }
  } catch { /* speech is a bonus, never a blocker */ }
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
  // And the browser voice this file speaks with directly — the correction and
  // the sentence read do not go through `utils/tts`, so `stopSpeaking()` does
  // not know about them. Leaving this out is how a learner who taps Exit
  // mid-correction keeps hearing the word spelled at them on the next screen.
  try { if (deviceSpeechAvailable()) window.speechSynthesis.cancel() } catch { /* nothing to stop */ }
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

/**
 * Wait for whatever `speakWord` started to actually FINISH.
 *
 * `playUrl` resolves when playback STARTS — `audio.play()`'s promise settles
 * on the first frame, not the last — so awaiting `speakWord` and then speaking
 * again lands the second utterance on top of the first. That is not
 * theoretical: it is the word and its own spelling talking over each other,
 * which is precisely the correction a missed letter is owed.
 *
 * Capped, because a stalled element that never fires `ended` must not leave
 * the correction unspoken forever.
 */
function whenAudioSettles(maxMs = 8000) {
  const audio = currentAudio
  if (!audio || audio.ended) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        audio.removeEventListener('ended', finish)
        audio.removeEventListener('error', finish)
      } catch { /* element already gone */ }
      resolve()
    }
    const timer = setTimeout(finish, maxMs)
    try {
      audio.addEventListener('ended', finish)
      audio.addEventListener('error', finish)
    } catch { finish() }
  })
}

/**
 * The browser voice, with the accent order applied.
 *
 * `queue: true` does NOT cancel what is already speaking, which is what lets
 * the letters land behind the word on the tier-3 path instead of cutting it
 * off mid-syllable.
 */
function speakWithDevice(text, { rate = 0.8, queue = false } = {}) {
  try {
    if (!deviceSpeechAvailable()) return false
    const utterance = new window.SpeechSynthesisUtterance(String(text).toLowerCase())
    const voice = currentVoice()
    if (voice) utterance.voice = voice
    // The tag is set whether or not a voice was found: a device that gave us
    // no list may still honour it.
    utterance.lang = voice?.lang || 'en-GB'
    utterance.rate = rate
    if (!queue) window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
    return true
  } catch {
    return false
  }
}

/**
 * Say a word and then SPELL IT OUT — "necessary… n, e, c, e, s, s, a, r, y".
 *
 * This is the correction after a wrong letter, and it is the lesson: a learner
 * who has just chosen the wrong letter needs to hear the right one in place,
 * slowly, more than they need to see a red tile.
 *
 * The WORD goes up the full ladder (it is the content); the LETTERS are the
 * device voice, queued behind it — see the quota note in the header. The
 * letters are a second utterance rather than a suffix on the first, because a
 * comma-separated string spoken at word rate runs the spelling past a child in
 * a second.
 */
export async function speakWordThenLetters(word, { audioUrl = '' } = {}) {
  const text = String(word || '').trim()
  if (!text) return false
  await speakWord(text, { audioUrl, rate: 0.75 })
  await whenAudioSettles()
  return speakWithDevice(text.split('').join(', '), { rate: 0.55, queue: true })
}

/**
 * Read a gap-fill sentence with "blank" at the gap.
 *
 * IT MUST NOT READ THE ANSWER. The sentence arrives with its gap still in it
 * and the gap is replaced here, so there is no path where the answer is spoken
 * — which there would be if the caller passed the filled-in sentence.
 */
export function speakSentence(sentence, { gap = '___' } = {}) {
  const text = String(sentence || '').split(gap).join(' blank ').replace(/\s+/g, ' ').trim()
  if (!text) return false
  return speakWithDevice(text, { rate: 0.85 })
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
