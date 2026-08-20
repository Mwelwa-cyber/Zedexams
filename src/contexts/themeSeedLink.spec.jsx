/**
 * The reported bug, end to end: signing in on a browser that has never saved
 * a theme (Edge, DuckDuckGo, a Chrome Incognito window) on a machine whose OS
 * is set to dark brought the app up dark — and the learner could not switch it
 * to light.
 *
 * WHY IT COULD NOT BE SWITCHED
 * There are two palette systems (teacherThemeCore.js): the reading palettes as
 * `theme-<id>` on <body>, and the teacher workspace palettes as `data-theme`
 * on <html>. index.css bridges the second onto the first —
 * `html[data-theme='night'] body` restates every reading token in dark
 * (themeBridge.test.js) — and that selector outranks `body.theme-<id>`.
 *
 * Both systems used to seed themselves from `prefers-color-scheme`
 * independently. A learner has exactly one theme control and it writes the
 * READING theme, so on a dark-OS machine the workspace attribute stayed
 * 'night' whatever they picked: the body class flipped to a light palette, the
 * bridge went on overriding it, and the page stayed dark with the Night toggle
 * reading "day".
 *
 * These assertions are about the ATTRIBUTE rather than about rendered colour,
 * because the attribute is what the bridge keys off and jsdom does not apply
 * the stylesheet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'
import { resetTeacherThemeStore } from './teacherThemeStore'

const READING_KEY = 'examprep:theme'
const WORKSPACE_KEY = 'zedexams-theme'

/** Put the machine's OS colour scheme where matchMedia will be asked for it. */
function setOsDark(dark) {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query === '(prefers-color-scheme: dark)' && dark,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false },
  }))
}

let api = null
function Probe() {
  api = useTheme()
  return null
}

const workspaceTheme = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.classList.remove('dark')
  resetTeacherThemeStore()
  api = null
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetTeacherThemeStore()
})

describe('a fresh browser on a dark-mode machine', () => {
  beforeEach(() => setOsDark(true))

  it('comes up dark in both systems — the two agree', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(api.theme).toBe('midnight')
    expect(workspaceTheme()).toBe('night')
  })

  it('goes fully light when the learner picks a light palette', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('oatmeal'))

    expect(api.theme).toBe('oatmeal')
    // THE REGRESSION. Left at 'night', the index.css bridge overrides every
    // token the oatmeal palette declares and the page stays dark. (The body
    // class itself is applied by <ThemeApplicator> inside the router, not by
    // the provider — ThemeContext.spec covers that half.)
    expect(workspaceTheme()).toBe('terracotta')
  })

  it('stays light on the next load of that browser', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('sky'))

    // Reload: the store re-reads from storage, exactly as boot.js does.
    resetTeacherThemeStore()
    document.documentElement.removeAttribute('data-theme')
    render(<ThemeProvider><Probe /></ThemeProvider>)

    expect(api.theme).toBe('sky')
    expect(workspaceTheme()).toBe('terracotta')
  })

  it('goes back to dark when the learner toggles Night on', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('oatmeal'))
    act(() => api.setTheme('midnight'))

    expect(api.theme).toBe('midnight')
    expect(workspaceTheme()).toBe('night')
  })

  it('the workspace follows the OS, so Midnight here is the OS answer', () => {
    // Same end state as the case above, but the reason matters: on a dark OS
    // 'night' is what the seed said before any of this existed. The next
    // describe block is the one that proves the reading palette is not what
    // put it there.
    localStorage.setItem(READING_KEY, 'midnight')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(workspaceTheme()).toBe('night')
  })

  it('never writes the workspace key — the seed stays an unanswered question', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('oatmeal'))
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull()
  })

  it('follows a theme hydrated from the signed-in profile', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    // What <ReadingThemeSync> does when the account's saved palette arrives.
    act(() => api.hydrateTheme('solar'))
    expect(workspaceTheme()).toBe('terracotta')
  })
})

describe('a device that saved a light palette in another session', () => {
  it('does not come up dark just because the OS is', () => {
    setOsDark(true)
    localStorage.setItem(READING_KEY, 'oatmeal')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    expect(workspaceTheme()).toBe('terracotta')
  })
})

/*
 * THE REGRESSION THE FIRST FIX SHIPPED (#2524 → #2535).
 *
 * Making the seed follow the reading palette in BOTH directions looked
 * tidier and broke production: a Midnight reading palette turned the
 * workspace dark on a light-OS machine, where it had always stayed light.
 * <ReadingThemeSync> syncs the reading palette to the ACCOUNT, so one learner
 * or teacher who had ever tapped Night carried a dark workspace to every
 * browser they signed in from.
 *
 * A reading palette is a statement about the page a learner reads on. It is
 * not a request to repaint the teacher workspace.
 */
describe('a dark reading palette on a light-mode machine', () => {
  beforeEach(() => setOsDark(false))

  it('leaves an unchosen workspace theme light', () => {
    localStorage.setItem(READING_KEY, 'midnight')
    render(<ThemeProvider><Probe /></ThemeProvider>)

    expect(api.theme).toBe('midnight')          // the learner reads in Midnight…
    expect(workspaceTheme()).toBe('terracotta') // …and the workspace stays light
  })

  it('leaves it light when the learner toggles Night on mid-session', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('midnight'))

    expect(workspaceTheme()).toBe('terracotta')
  })

  it('leaves it light when Midnight arrives from the signed-in profile', () => {
    // The exact production path: the account remembers Midnight and
    // <ReadingThemeSync> hydrates it on a machine whose OS is light.
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.hydrateTheme('midnight'))

    expect(workspaceTheme()).toBe('terracotta')
  })

  it('honours the legacy "dark" alias the same way', () => {
    localStorage.setItem(READING_KEY, 'dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)

    expect(api.theme).toBe('midnight')
    expect(workspaceTheme()).toBe('terracotta')
  })
})

describe('a CHOSEN workspace theme', () => {
  it('is never overridden by the reading palette — that is what the bridge is for', () => {
    setOsDark(false)
    localStorage.setItem(WORKSPACE_KEY, 'night')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('oatmeal'))

    expect(workspaceTheme()).toBe('night')
    expect(localStorage.getItem(WORKSPACE_KEY)).toBe('night')
  })

  it('survives a reading-theme change even when it matches the seed anyway', () => {
    setOsDark(true)
    localStorage.setItem(WORKSPACE_KEY, 'miombo')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('midnight'))

    expect(workspaceTheme()).toBe('miombo')
  })

  it('counts the retired dashboard dark toggle as a choice', () => {
    setOsDark(false)
    localStorage.setItem('zedexams:tdv2-theme', 'dark')
    render(<ThemeProvider><Probe /></ThemeProvider>)
    act(() => api.setTheme('oatmeal'))

    expect(workspaceTheme()).toBe('night')
  })
})
