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
 * ── WARMING: why the ladder is climbed BEFORE the word is asked for ───────
 * The ladder was correct and it was late. Every tier began its work at the
 * instant the word was needed and not a moment sooner: tier 1 handed a remote
 * URL to a fresh `Audio` element, so the first play of every word was a cold
 * Storage round trip; tier 2 minted an ID token, minted an App Check token,
 * crossed to us-central1, waited on synthesis and only then had bytes. On a
 * Zambian mobile connection that is seconds — and the learner is looking at
 * the tiles, or watching a row of letters already coming down the road, the
 * whole time. Spelling Ride made it indefensible: a word announced two
 * seconds late is announced after its first letter has been answered.
 *
 * So the clip is prepared AHEAD of the moment it is played. `warmWord` /
 * `warmWords` resolve the same ladder into a buffered `<audio>` element and
 * park it in `clips`; `speakWord` finds it there and plays on the next tick.
 * Nothing about WHICH tier answers changed — only when the waiting happens.
 *
 * Two rules keep warming honest, and they are the reason it does not simply
 * warm everything:
 *
 *   • A PRE-GENERATED file is free to warm — no quota, no rate limit, no cost
 *     — so a caller may warm a whole town's worth on spec (`cloud: false`).
 *   • A CLOUD word costs the learner one of their sixty daily calls, so it is
 *     warmed only when it is certain to be spoken: the word the round is
 *     about to present, the next word in the queue (every word in a stage is
 *     spoken on arrival), the chunk the coach is about to have tapped. Warming
 *     a maybe would be spending a learner's allowance on a guess.
 *
 * A warm that fails is not an error and is never reported as one: the word
 * simply climbs the ladder at play time exactly as it used to.
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
 * Key → a clip that can play NOW: a buffered `<audio>` element, plus the
 * object URL behind it when tier 2 made one.
 *
 * Bounded, and the bound has to RELEASE rather than merely forget. An
 * un-revoked object URL is a leak the GC cannot collect, and an `<audio>`
 * element still holding a decoded buffer is memory on a phone that has little
 * of it — so eviction pauses the element, drops its source and revokes the
 * URL. The clip currently playing is never the victim.
 */
const clips = new Map()

/**
 * Key → the in-flight promise preparing that clip.
 *
 * This is what stops a warm and the play that follows it from making the same
 * request twice — the round warms a word and speaks it 350ms later, and
 * without this the second call would spend a second cloud request on audio
 * already on its way.
 */
const pending = new Map()

/**
 * A stage is eight words, a nine-town ride up to thirty-six, and the coach
 * adds a handful of chunks. This holds a full ride with room to spare while
 * staying small enough that a cheap phone never notices.
 */
const MAX_CLIPS = 48

/** How long a warm waits for buffering before giving up on the wait. */
const WARM_TIMEOUT_MS = 12000

/** Everything currently making noise, so `stopSpeech` can silence all of it. */
let currentAudio = null

/**
 * Bumped by every new utterance and by `stopSpeech`.
 *
 * `speakWord` climbs a ladder with awaits in it, so a call can still be
 * partway down when the learner moves on. Without a token, a play that lost a
 * race (its element paused by the next word) reads as "that tier failed" and
 * falls through to the next one — which is a second voice talking over the
 * first, and after `stopSpeech` it is a word spoken on a screen the learner
 * has already left.
 */
let playToken = 0

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

/**
 * Silence everything, without touching the play token.
 *
 * Split out of `stopSpeech` because starting a clip has to stop the previous
 * one, and it must not invalidate the very call that is starting.
 */
function silence() {
  try {
    if (currentAudio) {
      currentAudio.pause()
      try { currentAudio.currentTime = 0 } catch { /* not seekable */ }
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

/** Stop whatever is being said, by any tier, and abandon any ladder mid-climb. */
export function stopSpeech() {
  playToken += 1
  silence()
}

/* ══════════════════════════════════════════════════════════════════════
 *  Preparing a clip
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * A pre-generated file is keyed by its URL and NOT by rate, because the rate
 * does nothing to it: a static object plays at the speed it was voiced at,
 * and `playClip` never touches `playbackRate`. Keying it by rate is how the
 * ride ended up fetching the same file twice — once at 0.85 to present the
 * word and again at 0.75 to correct it.
 */
function fileKey(url) { return `file:${url}` }

/** A synthesised clip IS rate-specific: Google honours the rate server-side. */
function ttsKey(text, rate) { return `tts:${String(text).toLowerCase()}|${rate}` }

function makeClip(key, src, objectUrl = '') {
  const audio = new window.Audio()
  // The whole point: start fetching and decoding now rather than at play.
  audio.preload = 'auto'
  // Deliberately NOT `crossOrigin` — an <audio> element needs no CORS headers
  // to PLAY a file, and asking for them would make every pre-generated word
  // depend on the bucket's cors.json being current. Reading the BYTES is what
  // needs CORS, and nothing here does.
  audio.src = src
  try { audio.load() } catch { /* jsdom, and browsers that autoload anyway */ }
  return { key, audio, objectUrl }
}

function release(clip) {
  if (!clip) return
  try { clip.audio.pause() } catch { /* already stopped */ }
  try {
    clip.audio.removeAttribute('src')
    clip.audio.load()
  } catch { /* nothing to drop */ }
  if (clip.objectUrl) {
    try { URL.revokeObjectURL(clip.objectUrl) } catch { /* already gone */ }
  }
}

function keep(clip) {
  clips.set(clip.key, clip)
  while (clips.size > MAX_CLIPS) {
    let victim = null
    for (const [key, held] of clips) {
      // Never evict what is playing — the element would go silent mid-word.
      if (held.audio !== currentAudio) { victim = key; break }
    }
    if (victim === null) break
    release(clips.get(victim))
    clips.delete(victim)
  }
  return clip
}

/** Stop offering a clip that would not play — a 404, a decode failure. */
function drop(clip) {
  if (!clip) return
  if (clips.get(clip.key) === clip) clips.delete(clip.key)
  release(clip)
}

/**
 * A clip for this word, preparing it if there is not one already.
 *
 * `cloud: false` means "do not spend one of the learner's sixty calls". It
 * still returns a pre-generated file and anything already prepared — it just
 * never STARTS a synthesis request. That is the flag a caller warming a whole
 * town on spec passes.
 *
 * Resolves null rather than throwing, always: the caller's next tier is the
 * answer to a failure here.
 */
function clipFor(text, { audioUrl = '', rate = 0.85, cloud = true } = {}) {
  if (!speechAvailable()) return Promise.resolve(null)
  const file = isPlayableAudioUrl(audioUrl) ? audioUrl : ''
  const key = file ? fileKey(file) : ttsKey(text, rate)

  const held = clips.get(key)
  if (held) return Promise.resolve(held)
  const inFlight = pending.get(key)
  if (inFlight) return inFlight

  if (!file && !cloud) return Promise.resolve(null)

  const work = (async () => {
    if (file) return keep(makeClip(key, file))
    // LOWERCASED, always: several voices spell an all-caps string out letter
    // by letter, which would read the answer aloud to a learner being asked to
    // produce it. The tiles are uppercase; what is spoken must not be.
    const url = await fetchSpeechUrl(String(text).toLowerCase(), { rate })
    if (!url) return null
    return keep(makeClip(key, url, url))
  })()
    .catch(() => null)
    .finally(() => { pending.delete(key) })

  pending.set(key, work)
  return work
}

/**
 * Wait until a clip can play through without stalling.
 *
 * `readyState >= HAVE_FUTURE_DATA` is the honest answer to "would this start
 * now", and the timeout is there because a stalled element fires neither
 * `canplaythrough` nor `error` — a warm that never settles would hold the
 * caller's sequential queue forever.
 */
function whenBuffered(clip, maxMs = WARM_TIMEOUT_MS) {
  const audio = clip?.audio
  if (!audio) return Promise.resolve(false)
  if (audio.readyState >= 3) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const name of ['canplaythrough', 'canplay', 'loadeddata', 'error']) {
        try { audio.removeEventListener(name, handlers[name]) } catch { /* gone */ }
      }
      resolve(ok)
    }
    const handlers = {
      canplaythrough: () => finish(true),
      canplay:        () => finish(true),
      loadeddata:     () => finish(true),
      error:          () => finish(false),
    }
    const timer = setTimeout(() => finish(false), maxMs)
    try {
      for (const name of Object.keys(handlers)) audio.addEventListener(name, handlers[name])
    } catch { finish(false) }
  })
}

/** Play a prepared clip. Resolves false when it could not, never throws. */
async function playClip(clip) {
  if (!clip?.audio) return false
  try {
    silence()
    const audio = clip.audio
    try { audio.currentTime = 0 } catch { /* not seekable until metadata lands */ }
    currentAudio = audio
    await audio.play()
    return true
  } catch {
    // Autoplay refusal, a 404 on a moved object, a decode failure, or a play
    // that was paused by the next word before it began. The caller decides.
    if (currentAudio === clip.audio) currentAudio = null
    return false
  }
}

/* ══════════════════════════════════════════════════════════════════════
 *  Warming
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Prepare one word so the next `speakWord` for it plays immediately.
 *
 * Resolves true when there is a buffered clip waiting. Resolves false for
 * every other outcome — no audio on this device, nothing to fetch, a refused
 * request, a stalled download — and none of those is an error: the word still
 * climbs the ladder when it is asked for.
 *
 * `cloud` defaults to false, which is the SAFE default for a caller warming
 * on spec. Pass true only for a word that is certain to be spoken.
 */
export async function warmWord(word, { audioUrl = '', rate = 0.85, cloud = false } = {}) {
  const text = String(word || '').trim()
  if (!text) return false
  try {
    const clip = await clipFor(text, { audioUrl, rate, cloud })
    if (!clip) return false
    return await whenBuffered(clip)
  } catch {
    return false
  }
}

/**
 * Warm a list, one at a time.
 *
 * SEQUENTIAL on purpose. These learners are on narrow connections, and eight
 * parallel downloads would compete with the word playing right now — which is
 * the exact latency this whole mechanism exists to remove. Warming is
 * background work and is allowed to take its time.
 *
 * Accepts plain words or the `{ word, audio }` records the banks already carry.
 */
export async function warmWords(items = [], { rate = 0.85, cloud = false, limit = 12 } = {}) {
  const list = Array.isArray(items) ? items.slice(0, Math.max(0, limit)) : []
  for (const entry of list) {
    const word = typeof entry === 'string' ? entry : entry?.word
    const audioUrl = typeof entry === 'string' ? '' : (entry?.audio || entry?.audioUrl || '')
    if (!word) continue
    await warmWord(word, { audioUrl, rate, cloud })
  }
}

/* ══════════════════════════════════════════════════════════════════════
 *  Speaking
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Say a word.
 *
 * `audioUrl` is the pre-generated object when the content has one. It is
 * checked for shape before it reaches an `Audio` element: the field is
 * written by the pipeline but is editable by an admin, and "it came from our
 * own database" is not a reason to hand an arbitrary string to a media
 * element.
 *
 * A warmed word is already in `clips` and plays on the next tick. A cold one
 * takes the same three tiers it always did — and, importantly, is NOT made to
 * wait for full buffering first: `playClip` starts it as soon as the element
 * has a source and lets the browser stream, which is exactly what the old
 * `new Audio(url).play()` did.
 */
export async function speakWord(word, { audioUrl = '', rate = 0.85 } = {}) {
  const text = String(word || '').trim()
  if (!text) return
  const token = ++playToken

  // Tier 1 — the pre-generated file, and anything a warm has already
  // prepared. Neither costs the learner a call.
  const ready = await clipFor(text, { audioUrl, rate, cloud: false })
  if (token !== playToken) return
  if (ready) {
    if (await playClip(ready)) return
    if (token !== playToken) return
    drop(ready)
  }

  // Tier 2 — the cloud voice, fetched ONCE and held for the session.
  const fetched = await clipFor(text, { rate, cloud: true })
  if (token !== playToken) return
  if (fetched) {
    if (await playClip(fetched)) return
    if (token !== playToken) return
    drop(fetched)
  }

  // Tier 3 — the browser voice. `speak()` reaches it through its own fallback
  // when the fetch returns nothing, which is also the signed-out path.
  try {
    await cloudSpeak(text.toLowerCase(), { rate })
  } catch { /* speech is a bonus, never a blocker */ }
}

/**
 * Say one chunk of a word — "sep", "a", "rate".
 *
 * Never pre-generated: a chunk is a fragment, it only appears after a miss on
 * one of the 79 authored cuts, and it is not worth an object each. The coach
 * warms them when it opens instead, which costs nothing extra — the rebuild
 * phase has the learner tap every one.
 *
 * The `rate` is passed through and MAY DO NOTHING. Google honours it;
 * ElevenLabs has no rate input and the server normalises it out of the cache
 * key so two rates cannot buy the same audio twice. Said here because a
 * reader would otherwise reasonably assume a chunk plays slower than a word
 * on every voice, and on the ElevenLabs voice it does not.
 */
export const CHUNK_RATE = 0.7

export async function speakChunk(chunk) {
  return speakWord(chunk, { rate: CHUNK_RATE })
}

/**
 * Wait for whatever `speakWord` started to actually FINISH.
 *
 * `playClip` resolves when playback STARTS — `audio.play()`'s promise settles
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
