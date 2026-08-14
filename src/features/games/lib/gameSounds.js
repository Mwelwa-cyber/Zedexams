/**
 * Tiny sound helper for the games surface.
 *
 * Generates short tones with the Web Audio API — no sound files needed.
 * Mute state persists in localStorage so the preference sticks across
 * sessions. Defaults to ON; one-tap mute toggle in the nav.
 *
 * Used by:
 *   - TimedQuizGame   (correct/wrong on each answer)
 *   - MemoryMatchGame (match/mismatch on flip)
 *   - WordBuilderGame (solve beep)
 */

const STORAGE_KEY = 'zedexams_games_muted'
let audioCtx = null
let soundsReady = false

function getMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

export function isMuted() { return getMuted() }

export function toggleMute() {
  const next = !getMuted()
  try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch {}
  return next
}

function ctx() {
  if (audioCtx) return audioCtx
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    audioCtx = new AC()
    return audioCtx
  } catch {
    return null
  }
}

/** Prime the audio context on first user gesture (iOS/Safari requirement). */
export function primeSounds() {
  if (soundsReady) return
  const c = ctx()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
  soundsReady = true
}

/**
 * Short haptic buzz for tactile feedback on mobile. Folded into the play*
 * helpers below so every game that already plays a sound also vibrates —
 * no per-game wiring needed. Honours `prefers-reduced-motion`, the shared
 * mute toggle, and silently no-ops where the Vibration API is unsupported
 * (iOS Safari, desktop) so it's always safe to call.
 *
 * @param {number|number[]} pattern ms, or an on/off pattern array
 */
export function haptic(pattern = 12) {
  if (getMuted()) return
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return
    navigator.vibrate(pattern)
  } catch {
    /* swallow — haptics are non-critical */
  }
}

function beep(freq, durMs, volume = 0.12, waveform = 'sine') {
  if (getMuted()) return
  const c = ctx()
  if (!c) return
  try {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = waveform
    osc.frequency.setValueAtTime(freq, c.currentTime)
    gain.gain.setValueAtTime(volume, c.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + durMs / 1000)
    osc.connect(gain).connect(c.destination)
    osc.start()
    osc.stop(c.currentTime + durMs / 1000)
  } catch {
    /* swallow — audio is non-critical */
  }
}

/** Bright two-note "yay" for a correct answer. */
export function playCorrect() {
  haptic(12)
  beep(660, 90)
  setTimeout(() => beep(880, 130), 80)
}

/** Low "nope" for a wrong answer. */
export function playWrong() {
  haptic([18, 40, 18])
  beep(220, 180, 0.10, 'sawtooth')
}

/** Celebratory rising triplet for a match / streak / badge. */
export function playWin() {
  haptic([16, 30, 16, 30, 28])
  beep(660, 80)
  setTimeout(() => beep(880, 80), 80)
  setTimeout(() => beep(1100, 160), 160)
}

/**
 * Escalating "combo" chime that rises with the streak level (0..3 from
 * gameFeel's comboHeat). Layered on top of playCorrect so a hot streak sounds
 * progressively brighter — the audio equivalent of the combo pill heating up.
 */
export function playStreak(level = 0) {
  const lvl = Math.max(0, Math.min(3, Math.floor(level)))
  if (lvl <= 0) return
  haptic(8 + lvl * 6)
  const base = 880 + lvl * 110
  beep(base, 70, 0.09, 'triangle')
  setTimeout(() => beep(base + 180, 90, 0.09, 'triangle'), 70)
}

/** Soft click for tile placement / card flip. */
export function playTick() {
  beep(520, 40, 0.06, 'triangle')
}
