/**
 * Lightweight sound-effects helper for results & study-path actions.
 *
 * Strategy:
 *   1. Try to play a short MP3/WAV from /sounds/ via HTMLAudioElement.
 *   2. If the file is missing or fails to play, fall back to a tiny
 *      Web Audio synthesised tone — so the feature works even before
 *      audio assets are added.
 *
 * Browser-autoplay rules: we never call play() without a prior user
 * gesture except inside an effect that runs after the learner has
 * already navigated to the results page (which counts as a gesture in
 * most browsers). If autoplay is blocked, the play() promise rejects
 * and we swallow it — the page keeps working.
 *
 * Mute preference is stored in localStorage (key: SFX_STORAGE_KEY).
 * Default is sound ON, but kept soft (volume ≤ 0.35).
 */

const SFX_STORAGE_KEY = 'zedexams_sfx_muted'
const SFX_BASE = '/sounds'

const FILES = {
  success: `${SFX_BASE}/result-success.mp3`,
  click:   `${SFX_BASE}/soft-click.mp3`,
  warning: `${SFX_BASE}/low-score-warning.mp3`,
}

const VOLUMES = {
  success: 0.35,
  click:   0.18,
  warning: 0.30,
}

let audioCtx = null
const audioCache = {}
const fileFailed = {}
const muteListeners = new Set()

function safeGet() {
  try { return localStorage.getItem(SFX_STORAGE_KEY) === '1' } catch { return false }
}

function safeSet(value) {
  try { localStorage.setItem(SFX_STORAGE_KEY, value ? '1' : '0') } catch {}
}

export function isMuted() {
  return safeGet()
}

export function toggleMute() {
  const next = !safeGet()
  safeSet(next)
  muteListeners.forEach(fn => { try { fn(next) } catch {} })
  return next
}

export function setMuted(value) {
  const next = Boolean(value)
  safeSet(next)
  muteListeners.forEach(fn => { try { fn(next) } catch {} })
  return next
}

export function subscribeMute(fn) {
  if (typeof fn !== 'function') return () => {}
  muteListeners.add(fn)
  return () => muteListeners.delete(fn)
}

function getCtx() {
  if (audioCtx) return audioCtx
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
    if (!AC) return null
    audioCtx = new AC()
    return audioCtx
  } catch {
    return null
  }
}

function fallbackTone(kind) {
  const ctx = getCtx()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})

    const tones =
      kind === 'success' ? [{ f: 660, d: 90 }, { f: 880, d: 130, delay: 80 }]
      : kind === 'warning' ? [{ f: 220, d: 220, wave: 'sawtooth', vol: 0.18 }]
      : [{ f: 520, d: 50, wave: 'triangle', vol: 0.10 }]

    tones.forEach(({ f, d, delay = 0, wave = 'sine', vol }) => {
      setTimeout(() => {
        try {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = wave
          osc.frequency.setValueAtTime(f, ctx.currentTime)
          const v = vol ?? VOLUMES[kind] ?? 0.15
          gain.gain.setValueAtTime(v, ctx.currentTime)
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d / 1000)
          osc.connect(gain).connect(ctx.destination)
          osc.start()
          osc.stop(ctx.currentTime + d / 1000)
        } catch { /* swallow */ }
      }, delay)
    })
  } catch { /* swallow */ }
}

function playFile(kind) {
  if (fileFailed[kind]) {
    fallbackTone(kind)
    return
  }

  try {
    let audio = audioCache[kind]
    if (!audio) {
      audio = new Audio(FILES[kind])
      audio.preload = 'auto'
      audio.volume = VOLUMES[kind] ?? 0.25
      audio.addEventListener('error', () => {
        fileFailed[kind] = true
      }, { once: true })
      audioCache[kind] = audio
    }

    try { audio.currentTime = 0 } catch {}
    const result = audio.play()
    if (result && typeof result.then === 'function') {
      result.catch(() => {
        // Autoplay blocked or file missing — fall back to a tone.
        fileFailed[kind] = true
        fallbackTone(kind)
      })
    }
  } catch {
    fileFailed[kind] = true
    fallbackTone(kind)
  }
}

function play(kind) {
  if (safeGet()) return
  if (typeof window === 'undefined') return
  try {
    playFile(kind)
  } catch {
    // Last-resort guard: never throw to caller.
  }
}

export function playSuccess() { play('success') }
export function playClick()   { play('click') }
export function playWarning() { play('warning') }

/** Prime the audio context on first user gesture (helps iOS/Safari). */
export function primeSounds() {
  const ctx = getCtx()
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
}
