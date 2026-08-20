/**
 * The device-voice half of `spellingSpeech` — the half nothing was executing.
 *
 * WHY THIS FILE EXISTS. Merging the ElevenLabs ladder (#2564) into Spelling
 * Ride's accent-ordered voice work dropped two module-level `let`s, and
 * NOTHING caught it: the production build never runs the code, the node guard
 * reads only the pure `spellingVoiceCore`, and every component spec mocks this
 * module wholesale. In ESM strict mode `chosen = …` with no declaration is a
 * ReferenceError, so the spoken correction would have thrown on the first
 * wrong letter of the first ride — on a path 261 green tests never touched.
 * Lint found it. Lint should not have been the only thing that could.
 *
 * So this executes the real module against a stubbed device, and covers
 * exactly the two legs that deliberately do NOT go up the cloud ladder: the
 * spelled-out correction and the gap-fill sentence read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cloud endpoint is stubbed rather than the ladder: the device-leg tests
// below want tier 1 and tier 2 to miss, and the warming tests want to count
// exactly how many synthesis calls a stage costs a learner. Hoisted so each
// test can say which.
const tts = vi.hoisted(() => ({
  fetchSpeechUrl: vi.fn(async () => ''),
  speak: vi.fn(async () => {}),
  stopSpeaking: vi.fn(),
}))
vi.mock('../../../utils/tts', () => tts)

const spoken = []
let cancelled = 0

function stubDevice({ voices = ['en-US', 'en-ZA', 'en-GB'] } = {}) {
  spoken.length = 0
  cancelled = 0
  class Utterance {
    constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.voice = null; this.volume = 1 }
  }
  window.SpeechSynthesisUtterance = Utterance
  window.speechSynthesis = {
    getVoices: () => voices.map((lang) => ({ lang, name: `voice ${lang}` })),
    speak: (u) => spoken.push(u),
    cancel: () => { cancelled += 1 },
    onvoiceschanged: null,
  }
}

/**
 * An `<audio>` element that behaves, so the clip cache can be observed.
 *
 * jsdom's own `HTMLMediaElement` never loads and never plays, so a real one
 * would make every assertion below a test of jsdom's refusals. This one
 * records what was asked of it. It plays INSTANTANEOUSLY — `ended` is true
 * the moment `play()` returns — which keeps `whenAudioSettles` deterministic
 * rather than leaving the correction test waiting out its eight-second cap.
 */
const audios = []
function stubAudio({ playFails = false } = {}) {
  audios.length = 0
  class FakeAudio {
    constructor() {
      this.preload = ''
      this.readyState = 0
      this.currentTime = 0
      this.ended = false
      this.paused = true
      this.plays = 0
      this.loads = 0
      this.handlers = {}
      audios.push(this)
    }
    set src(value) { this.source = value; this.readyState = value ? 4 : 0 }
    get src() { return this.source || '' }
    removeAttribute() { this.source = '' }
    load() { this.loads += 1 }
    play() {
      this.plays += 1
      this.paused = false
      if (playFails) return Promise.reject(new Error('refused'))
      this.ended = true
      return Promise.resolve()
    }
    pause() { this.paused = true }
    addEventListener(name, fn) { (this.handlers[name] = this.handlers[name] || []).push(fn) }
    removeEventListener() {}
  }
  window.Audio = FakeAudio
}

/** A fresh module per test — `chosen`/`primed` are module state by design. */
async function loadSpeech() {
  vi.resetModules()
  return import('./spellingSpeech.js')
}

describe('spellingSpeech — the device leg', () => {
  beforeEach(() => { stubDevice() })

  it('primes inside a gesture without throwing, and picks the preferred accent', async () => {
    const speech = await loadSpeech()
    // The regression: this threw ReferenceError when the declarations went
    // missing in the merge.
    expect(() => speech.primeSpeech()).not.toThrow()
    expect(speech.currentVoice().lang).toBe('en-ZA')
    // A silent warm-up utterance, so iOS will speak later.
    expect(spoken).toHaveLength(1)
    expect(spoken[0].volume).toBe(0)
  })

  it('primes only once', async () => {
    const speech = await loadSpeech()
    speech.primeSpeech()
    speech.primeSpeech()
    expect(spoken).toHaveLength(1)
  })

  it('spells the word out after saying it, queued rather than cutting it off', async () => {
    const speech = await loadSpeech()
    await speech.speakWordThenLetters('NECESSARY')

    const letters = spoken.at(-1)
    expect(letters.text).toBe('n, e, c, e, s, s, a, r, y')
    // Slower than a word: a spelling read at word rate is unusable.
    expect(letters.rate).toBeLessThan(0.7)
    // The word leg (tier 3) cancels; the letters leg must NOT, or it cuts the
    // word off mid-syllable.
    expect(cancelled).toBeLessThanOrEqual(1)
  })

  it('reads a gap-fill sentence with "blank" and never the answer', async () => {
    const speech = await loadSpeech()
    expect(speech.speakSentence('Be ___ while the teacher is speaking.')).toBe(true)
    expect(spoken.at(-1).text).toBe('be blank while the teacher is speaking.')
    expect(spoken.at(-1).text).not.toContain('quiet')
  })

  it('stops the browser voice as well as the audio element', async () => {
    const speech = await loadSpeech()
    speech.speakSentence('Say ___ now.')
    const before = cancelled
    speech.stopSpeech()
    expect(cancelled).toBeGreaterThan(before)
  })

  it('says nothing, and does not throw, on a device with no speech at all', async () => {
    delete window.speechSynthesis
    delete window.SpeechSynthesisUtterance
    const speech = await loadSpeech()
    expect(speech.deviceSpeechAvailable()).toBe(false)
    expect(speech.speakSentence('A ___ sentence.')).toBe(false)
    expect(() => speech.primeSpeech()).not.toThrow()
    expect(() => speech.stopSpeech()).not.toThrow()
  })
})

/**
 * WARMING — the fix for a voice that arrived after the learner had guessed.
 *
 * These tests are about WHEN the work happens and WHAT IT COSTS, which are the
 * two things the warming rules trade against each other. A learner gets sixty
 * AI calls a day across the whole product, so "fetch everything early" is not
 * available: a pre-generated file may be warmed on spec because it is free,
 * and a synthesis call may be warmed only for a word that is certain to be
 * spoken. Every assertion below pins one half of that.
 */
describe('spellingSpeech — warming the ladder before the word is asked for', () => {
  const FILE = 'https://storage.example.com/spelling-audio/g7/necessary.mp3'

  beforeEach(() => {
    stubDevice()
    stubAudio()
    tts.fetchSpeechUrl.mockReset()
    tts.fetchSpeechUrl.mockResolvedValue('blob:synthesised')
    tts.speak.mockReset()
    tts.stopSpeaking.mockReset()
  })

  it('prepares a pre-generated file without playing it, and without the cloud', async () => {
    const speech = await loadSpeech()
    expect(await speech.warmWord('NECESSARY', { audioUrl: FILE })).toBe(true)
    expect(audios).toHaveLength(1)
    expect(audios[0].src).toBe(FILE)
    // `preload = 'auto'` IS the fix — without it the element does nothing at
    // all until `play()`, which is where the whole wait used to live.
    expect(audios[0].preload).toBe('auto')
    expect(audios[0].plays).toBe(0)
    expect(tts.fetchSpeechUrl).not.toHaveBeenCalled()
  })

  it('plays a warmed word from the element already holding it', async () => {
    const speech = await loadSpeech()
    await speech.warmWord('NECESSARY', { audioUrl: FILE })
    await speech.speakWord('NECESSARY', { audioUrl: FILE })
    // One element, so one download: the play did not start a second fetch of
    // the file the warm had already pulled.
    expect(audios).toHaveLength(1)
    expect(audios[0].plays).toBe(1)
  })

  it('never spends a synthesis call warming on spec, and does spend one on a certainty', async () => {
    const speech = await loadSpeech()
    // No pre-generated file, `cloud` left at its default: this is the warm a
    // caller does for a whole town, and it must cost the learner nothing.
    expect(await speech.warmWord('SEPARATE')).toBe(false)
    expect(tts.fetchSpeechUrl).not.toHaveBeenCalled()
    // The same word once it is certain to be spoken.
    expect(await speech.warmWord('SEPARATE', { cloud: true })).toBe(true)
    expect(tts.fetchSpeechUrl).toHaveBeenCalledTimes(1)
  })

  it('warms a list without letting the free files reach the cloud', async () => {
    const speech = await loadSpeech()
    await speech.warmWords([
      { word: 'NECESSARY', audio: FILE },
      { word: 'SEPARATE' },
      'BECAUSE',
    ])
    expect(audios).toHaveLength(1)
    expect(tts.fetchSpeechUrl).not.toHaveBeenCalled()
  })

  it('a warm and the word spoken behind it share one request', async () => {
    const speech = await loadSpeech()
    const warming = speech.warmWord('SEPARATE', { cloud: true })
    const saying = speech.speakWord('SEPARATE')
    await Promise.all([warming, saying])
    // The round warms a word and speaks it 350ms later. Without the in-flight
    // map that is two calls off a learner's sixty for one word.
    expect(tts.fetchSpeechUrl).toHaveBeenCalledTimes(1)
  })

  it('holds a cloud word for the session, so hearing it again costs nothing', async () => {
    const speech = await loadSpeech()
    await speech.speakWord('SEPARATE')
    await speech.speakWord('SEPARATE')
    expect(tts.fetchSpeechUrl).toHaveBeenCalledTimes(1)
  })

  it('the correction replays the presented file rather than re-fetching it at another rate', async () => {
    const speech = await loadSpeech()
    await speech.speakWord('NECESSARY', { audioUrl: FILE })             // presenting, 0.85
    await speech.speakWordThenLetters('NECESSARY', { audioUrl: FILE })  // correcting, 0.75
    // A static object plays at the speed it was voiced at, so keying it by
    // rate bought the same file twice — once per rate — and made the
    // correction wait on a download it already had.
    expect(audios).toHaveLength(1)
    expect(audios[0].plays).toBe(2)
    expect(tts.fetchSpeechUrl).not.toHaveBeenCalled()
  })

  it('still climbs the whole ladder when a prepared file will not play', async () => {
    stubAudio({ playFails: true })
    const speech = await loadSpeech()
    await speech.speakWord('NECESSARY', { audioUrl: FILE })
    // Tier 1 refused, tier 2 fetched and refused, tier 3 read it.
    expect(tts.fetchSpeechUrl).toHaveBeenCalledTimes(1)
    expect(tts.speak).toHaveBeenCalledTimes(1)
    // A file that would not play is not left in the cache to be offered again.
    stubAudio()
    await speech.speakWord('NECESSARY', { audioUrl: FILE })
    expect(audios[0].plays).toBe(1)
  })

  it('abandons a ladder mid-climb when the learner leaves the screen', async () => {
    const speech = await loadSpeech()
    const saying = speech.speakWord('SEPARATE')
    speech.stopSpeech()
    await saying
    // Neither a call spent nor a word spoken over whatever came next.
    expect(tts.fetchSpeechUrl).not.toHaveBeenCalled()
    expect(tts.speak).not.toHaveBeenCalled()
    expect(audios.every((audio) => audio.plays === 0)).toBe(true)
  })

  it('reports no audio at all rather than throwing on a device without <audio>', async () => {
    // Not restored here — `beforeEach` re-stubs it, and putting the assignment
    // after the awaits is the shape lint flags as a race.
    delete window.Audio
    const speech = await loadSpeech()
    expect(speech.speechAvailable()).toBe(false)
    expect(await speech.warmWord('NECESSARY', { audioUrl: FILE })).toBe(false)
    await expect(speech.speakWord('NECESSARY', { audioUrl: FILE })).resolves.toBeUndefined()
  })
})
