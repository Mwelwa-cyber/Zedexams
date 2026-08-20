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

// The ladder itself is somebody else's test. Stubbed so tier 1 and tier 2
// always miss and the device leg is what runs.
vi.mock('../../../utils/tts', () => ({
  fetchSpeechUrl: vi.fn(async () => ''),
  speak: vi.fn(async () => {}),
  stopSpeaking: vi.fn(),
}))

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
