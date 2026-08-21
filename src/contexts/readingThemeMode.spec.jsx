/**
 * "The dark mode, again, it's back."
 *
 * THE BUG
 * The reading theme had two storage states — a saved palette, or nothing —
 * and "nothing" meant "ask the operating system". Two states doing the work
 * of three, and the missing one is the one people ask for: *always light*.
 *
 * A saved light palette expressed it, but only on the device holding the key.
 * In any context that key was absent — a second browser, an Incognito window,
 * a cleared profile, the signed-out site before auth resolves — the OS
 * answered instead. And because the seed is deliberately never written, it
 * answered again on every single cold start. Measured against the built app
 * before this change: three consecutive reloads of a dark-OS browser, all
 * three Midnight, `examprep:theme` still null afterwards.
 *
 * So nothing was re-imposing dark. It had simply never been recorded that it
 * should be off, and every fresh context re-derived it from the machine.
 *
 * WHAT IS ASSERTED HERE
 * The three properties that make an answer an answer. They are written
 * against a REMOUNTED provider rather than a single render, because "it comes
 * back" is a statement about the next cold start — a test that only checks
 * the live value would have passed throughout the entire life of the bug.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'
import { resetTeacherThemeStore } from './teacherThemeStore'

const PALETTE_KEY = 'examprep:theme'
const MODE_KEY = 'examprep:themeMode'
const LIGHT_KEY = 'examprep:lightTheme'

/**
 * The machine's colour scheme, with real listener plumbing — 'system' mode
 * subscribes, and a stub that swallowed the subscription would make the
 * follow-the-device test pass without anything following.
 */
const listeners = new Set()
function setOsDark(dark) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query === '(prefers-color-scheme: dark)' && dark,
    media: query,
    addEventListener: (_, fn) => listeners.add(fn),
    removeEventListener: (_, fn) => listeners.delete(fn),
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
    dispatchEvent() { return false },
  }))
}
function flipOsTo(dark) {
  setOsDark(dark)
  act(() => { listeners.forEach((fn) => fn({ matches: dark })) })
}

let api = null
function Probe() {
  api = useTheme()
  return null
}

/** Mount a fresh provider — this is the "next cold start". */
function coldStart() {
  const view = render(<ThemeProvider><Probe /></ThemeProvider>)
  return view
}

beforeEach(() => {
  localStorage.clear()
  listeners.clear()
  document.body.className = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  resetTeacherThemeStore()
  api = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  listeners.clear()
  resetTeacherThemeStore()
})

describe('an explicit answer outranks the machine', () => {
  it('keeps light across cold starts on a dark-mode machine', () => {
    setOsDark(true)
    const first = coldStart()
    // Unanswered, so the machine decides — this part is unchanged and correct.
    expect(api.theme).toBe('midnight')
    expect(api.themeMode).toBe('system')

    act(() => api.setThemeMode('light'))
    expect(api.theme).toBe('oatmeal')
    first.unmount()

    // THE REGRESSION. Three cold starts, OS still dark. Before the mode
    // existed every one of these came up Midnight.
    for (let i = 0; i < 3; i += 1) {
      const again = coldStart()
      expect(api.theme, `cold start ${i + 1} must still be light`).toBe('oatmeal')
      expect(api.themeMode).toBe('light')
      again.unmount()
    }
  })

  it('keeps dark across cold starts on a light-mode machine', () => {
    setOsDark(false)
    const first = coldStart()
    act(() => api.setThemeMode('dark'))
    expect(api.theme).toBe('midnight')
    first.unmount()

    coldStart()
    expect(api.theme).toBe('midnight')
    expect(api.themeMode).toBe('dark')
  })

  it('records the answer where the pre-paint guard will find it', () => {
    // boot.js paints from localStorage before any bundle runs. An answer the
    // provider holds but never writes is an answer that flashes the wrong
    // palette on every load and loses entirely in a context that never
    // reaches hydration.
    setOsDark(true)
    coldStart()
    act(() => api.setThemeMode('light'))
    expect(localStorage.getItem(MODE_KEY)).toBe('light')
    expect(localStorage.getItem(PALETTE_KEY)).toBe('oatmeal')
    expect(localStorage.getItem(LIGHT_KEY)).toBe('oatmeal')
  })

  it('never writes an answer for a visitor who has not given one', () => {
    // The seed must stay unwritten, or "follow my device" freezes on
    // whatever the machine happened to say the first time.
    setOsDark(true)
    coldStart()
    expect(api.themeMode).toBe('system')
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
    expect(localStorage.getItem(PALETTE_KEY)).toBeNull()
  })
})

describe('picking a palette is picking a mode', () => {
  it('treats any light palette as the light answer, and remembers which', () => {
    setOsDark(true)
    const first = coldStart()
    act(() => api.setTheme('sky'))
    expect(api.themeMode).toBe('light')
    first.unmount()

    coldStart()
    expect(api.theme).toBe('sky')

    // …and leaving dark returns to Sky rather than the brand default. This
    // is what the two `lhx:last-light-theme` copies used to do, once, each.
    act(() => api.setThemeMode('dark'))
    expect(api.theme).toBe('midnight')
    act(() => api.setThemeMode('light'))
    expect(api.theme).toBe('sky')
  })

  it('treats Midnight as the dark answer', () => {
    setOsDark(false)
    const first = coldStart()
    act(() => api.setTheme('midnight'))
    expect(api.themeMode).toBe('dark')
    first.unmount()

    coldStart()
    expect(api.theme).toBe('midnight')
  })
})

describe('the migration', () => {
  it('reads a palette saved before modes existed as the answer it always was', () => {
    // Every existing reader is in exactly this state: a palette key and no
    // mode. Reading them as "unanswered" would hand the whole population back
    // to the operating system, which is the bug rather than the fix.
    localStorage.setItem(PALETTE_KEY, 'oatmeal')
    setOsDark(true)
    coldStart()
    expect(api.themeMode).toBe('light')
    expect(api.theme).toBe('oatmeal')
  })

  it('reads a saved Midnight as the dark answer', () => {
    localStorage.setItem(PALETTE_KEY, 'midnight')
    setOsDark(false)
    coldStart()
    expect(api.themeMode).toBe('dark')
    expect(api.theme).toBe('midnight')
  })

  it('carries a reader already on Sky across without moving them', () => {
    localStorage.setItem(PALETTE_KEY, 'sky')
    setOsDark(true)
    coldStart()
    expect(api.theme).toBe('sky')
    expect(api.lightTheme).toBe('sky')
  })

  it('adopts the retired per-device light memory', () => {
    localStorage.setItem(PALETTE_KEY, 'midnight')
    localStorage.setItem('lhx:last-light-theme', 'solar')
    setOsDark(true)
    coldStart()
    act(() => api.setThemeMode('light'))
    expect(api.theme).toBe('solar')
  })
})

describe('system mode follows the device, live', () => {
  it('flips when the machine flips', () => {
    // The one thing "system" is for, and the one thing it did not do: the OS
    // was sampled once at module init, so a laptop switching to dark at
    // sunset stayed light until the next reload.
    setOsDark(false)
    coldStart()
    act(() => api.setThemeMode('system'))
    expect(api.theme).toBe('oatmeal')

    flipOsTo(true)
    expect(api.theme).toBe('midnight')

    flipOsTo(false)
    expect(api.theme).toBe('oatmeal')
  })

  it('does not move an explicit answer when the machine flips', () => {
    setOsDark(false)
    coldStart()
    act(() => api.setThemeMode('light'))

    flipOsTo(true)
    expect(api.theme).toBe('oatmeal')
    expect(api.themeMode).toBe('light')
  })

  it('is itself an answer, and survives a cold start', () => {
    // 'system' stored is the difference between "I have not chosen" and "I
    // have chosen to follow my device" — only the second can travel to
    // another browser through the account.
    setOsDark(true)
    const first = coldStart()
    act(() => api.setThemeMode('system'))
    expect(localStorage.getItem(MODE_KEY)).toBe('system')
    first.unmount()

    coldStart()
    expect(api.themeMode).toBe('system')
    expect(api.theme).toBe('midnight')
  })
})

describe('the account answer reaches this device', () => {
  it('adopts a mode hydrated from the profile even when the palette matches', () => {
    // The case that carries the fix to a browser the reader has never used:
    // the palette can already agree by accident (both dark) while the MODE —
    // the part that stops this browser asking the OS — has never been seen.
    setOsDark(true)
    coldStart()
    expect(api.theme).toBe('midnight')
    expect(api.themeMode).toBe('system')

    act(() => api.hydrateTheme({ theme: 'midnight', mode: 'dark', light: 'sky' }))
    expect(api.themeMode).toBe('dark')

    flipOsTo(false)
    expect(api.theme, 'the account said dark, so the machine gets no vote').toBe('midnight')
  })

  it('still accepts a bare palette from a profile that predates modes', () => {
    setOsDark(true)
    coldStart()
    act(() => api.hydrateTheme('solar'))
    expect(api.theme).toBe('solar')
    expect(api.themeMode).toBe('light')
  })

  it('ignores a profile carrying neither a palette nor a mode', () => {
    setOsDark(true)
    coldStart()
    act(() => api.hydrateTheme({}))
    expect(api.themeMode).toBe('system')
    expect(localStorage.getItem(MODE_KEY)).toBeNull()
  })
})
