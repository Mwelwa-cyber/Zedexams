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
 * THREE THINGS ABOUT IT ARE LOAD-BEARING:
 *
 *   `en-GB`, ALWAYS. ECZ marks British forms and a US voice says "z" for the
 *   letter Z and reads "practise" as "practice". The voice is part of the
 *   content rule, not a preference.
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

function speakWithDevice(text, rate) {
  try {
    if (!speechAvailable()) return
    const utterance = new window.SpeechSynthesisUtterance(String(text).toLowerCase())
    utterance.lang = 'en-GB'
    utterance.rate = rate
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  } catch { /* speech is a bonus, never a blocker */ }
}
