/**
 * Saying a word out loud — the ONE audio path the spelling system uses.
 *
 * It is the browser's own `speechSynthesis`, which is what every other game in
 * this repo already uses, and it stays that way deliberately: no second audio
 * provider is introduced for spelling. A recorded voice would be better, and
 * the content model has an `audio` field waiting for one — `speakWord` plays a
 * recording when a word has one and falls back to the device voice when it
 * does not, so adding recordings later is a content job and not a code change.
 *
 * FOUR THINGS ABOUT IT ARE LOAD-BEARING:
 *
 *   A BRITISH-FORMS ENGLISH, ALWAYS. ECZ marks British spelling, and a US
 *   voice says "zee" for the letter Z and reads "practise" as "practice". The
 *   voice is part of the content rule, not a preference.
 *
 *   Within that rule the accent IS a preference, and it is ordered: en-ZA
 *   first, then en-GB, then the other African and Commonwealth Englishes, and
 *   only then en-US. A Zambian learner has heard a South African accent all
 *   their life and a Midwestern one on television; the first is easier to
 *   spell along with. This was `lang = 'en-GB'` and no voice choice at all,
 *   which left the pick to the device — and a device with one US voice
 *   installed ignored the tag entirely. `resolveVoice` is what makes the rule
 *   a decision rather than a hint, and a device with no English voice at all
 *   still falls through to whatever it has rather than going silent.
 *
 *   SLOWER THAN SPEECH. A word being spelled has to be heard letter-group by
 *   letter-group, and the default rate runs "necessary" past a child in half a
 *   second. 0.8 for a word, slower still for a chunk.
 *
 *   IT NEVER THROWS AND NEVER BLOCKS. Speech is unavailable in a lot of the
 *   places this app runs — some Android WebViews, some locked-down browsers,
 *   a device with no voices installed. The game has to be fully playable
 *   without it, so `speechAvailable()` is what the screen asks before drawing
 *   a Hear it button, and a failure to speak is swallowed rather than shown.
 */

/** A cached <audio> per recorded word, so re-hearing costs no second fetch. */
const recordings = new Map()

/**
 * Accent order. British forms first, then the Englishes a Zambian learner is
 * most likely to have heard, then anything.
 */
export const VOICE_PREFERENCE = Object.freeze([
  'en-za', 'en-gb', 'en-ke', 'en-ng', 'en-in', 'en-au', 'en-us', 'en',
])

/** The chosen voice, resolved once and re-resolved when the device list lands. */
let chosen = null
let primed = false

/**
 * Pick a voice out of a list, by the preference order above.
 *
 * PURE, and exported, so `test:spelling-ride` can assert the order against a
 * fabricated device list — the one part of speech that can be tested without a
 * browser, and the part most likely to be got wrong.
 */
export function resolveVoice(voices = []) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : []
  if (!list.length) return null
  const langOf = (v) => String(v.lang || '').replace('_', '-').toLowerCase()
  for (const wanted of VOICE_PREFERENCE) {
    const hit = list.find((v) => langOf(v).indexOf(wanted) === 0)
    if (hit) return hit
  }
  return list.find((v) => langOf(v).indexOf('en') === 0) || null
}

function deviceVoices() {
  try {
    return speechAvailable() ? (window.speechSynthesis.getVoices() || []) : []
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
  if (primed || !speechAvailable()) return
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

/** Is device speech usable at all? Asked before a Hear it button is drawn. */
export function speechAvailable() {
  return typeof window !== 'undefined'
    && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function'
}

/** Stop whatever is currently being said. */
export function stopSpeech() {
  try {
    if (speechAvailable()) window.speechSynthesis.cancel()
    for (const audio of recordings.values()) {
      audio.pause()
      audio.currentTime = 0
    }
  } catch { /* nothing to stop */ }
}

/**
 * Say a word. A recorded `audioUrl` wins; otherwise the device voice.
 *
 * The text is lowercased before it is spoken because several voices spell out
 * an all-caps string letter by letter — which would read the answer aloud.
 */
export function speakWord(word, { audioUrl = '', rate = 0.8 } = {}) {
  const text = String(word || '').trim()
  if (!text) return
  if (audioUrl) {
    try {
      let audio = recordings.get(audioUrl)
      if (!audio) {
        audio = new Audio(audioUrl)
        recordings.set(audioUrl, audio)
      }
      stopSpeech()
      audio.currentTime = 0
      const played = audio.play()
      if (played?.catch) played.catch(() => speakWithDevice(text, rate))
      return
    } catch {
      // fall through to the device voice
    }
  }
  speakWithDevice(text, rate)
}

/** A single chunk of a word, said slower still — "sep", "a", "rate". */
export function speakChunk(chunk) {
  speakWord(chunk, { rate: 0.65 })
}

/**
 * Say a word and then SPELL IT OUT — "necessary… n, e, c, e, s, s, a, r, y".
 *
 * This is the correction after a wrong letter, and it is the lesson: a learner
 * who has just chosen the wrong letter needs to hear the right one in place,
 * slowly, more than they need to see a red tile. The letters are queued as a
 * second utterance rather than appended to the first, because a comma-separated
 * string spoken at word rate runs the spelling past a child in a second.
 *
 * Returns false when nothing was said, so a caller can fall back to showing it.
 */
export function speakWordThenLetters(word) {
  const text = String(word || '').trim()
  if (!text || !speechAvailable()) return false
  speakWithDevice(text, 0.75)
  try {
    const letters = new window.SpeechSynthesisUtterance(text.toLowerCase().split('').join(', '))
    const voice = currentVoice()
    if (voice) letters.voice = voice
    letters.lang = voice?.lang || 'en-GB'
    letters.rate = 0.55
    // QUEUED, not cancelled into: `speakWithDevice` has just cleared the queue
    // and started the word, so this lands behind it.
    window.speechSynthesis.speak(letters)
  } catch { /* the word was said; the spelling is the bonus */ }
  return true
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
  speakWithDevice(text, 0.85)
  return true
}

function speakWithDevice(text, rate) {
  try {
    if (!speechAvailable()) return
    const utterance = new window.SpeechSynthesisUtterance(String(text).toLowerCase())
    const voice = currentVoice()
    if (voice) utterance.voice = voice
    // The tag is set whether or not a voice was found: a device that gave us
    // no list may still honour it.
    utterance.lang = voice?.lang || 'en-GB'
    utterance.rate = rate
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  } catch { /* speech is a bonus, never a blocker */ }
}
