/**
 * Behavioural tests for ThemeContext.
 *
 * The theme layer wraps the whole app: a regression in id normalisation or
 * persistence flips every visitor's palette or throws away a saved choice.
 * This locks down the pure helpers (normalizeThemeId / applyThemeToBody) and
 * the provider's persistence + initial-theme resolution. No Firebase — the
 * module only touches localStorage + document.body.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import {
  THEMES,
  DEFAULT_THEME,
  normalizeThemeId,
  applyThemeToBody,
  ThemeProvider,
  useTheme,
} from './ThemeContext'

const LS_KEY = 'examprep:theme'

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  document.documentElement.classList.remove('dark')
})

describe('normalizeThemeId', () => {
  it('passes through a known theme id', () => {
    expect(normalizeThemeId('sky')).toBe('sky')
    expect(normalizeThemeId('midnight')).toBe('midnight')
  })

  it('maps legacy aliases to their modern id', () => {
    expect(normalizeThemeId('light')).toBe('sky')
    expect(normalizeThemeId('warm')).toBe('oatmeal')
    expect(normalizeThemeId('dark')).toBe('midnight')
  })

  it('maps the retired themes to their nearest surviving palette', () => {
    expect(normalizeThemeId('lavender')).toBe('sky')
    expect(normalizeThemeId('vivid')).toBe('solar')
  })

  it('offers exactly the four reading themes, default first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['oatmeal', 'sky', 'solar', 'midnight'])
    expect(THEMES[0].id).toBe(DEFAULT_THEME)
  })

  it('falls back to the default for anything unknown', () => {
    expect(normalizeThemeId('neon')).toBe(DEFAULT_THEME)
    expect(normalizeThemeId(undefined)).toBe(DEFAULT_THEME)
    expect(normalizeThemeId('')).toBe(DEFAULT_THEME)
  })
})

describe('applyThemeToBody', () => {
  it('adds the theme-<id> class', () => {
    applyThemeToBody('sky')
    expect(document.body.classList.contains('theme-sky')).toBe(true)
  })

  it('removes the previous theme class when switching', () => {
    applyThemeToBody('sky')
    applyThemeToBody('midnight')
    expect(document.body.classList.contains('theme-sky')).toBe(false)
    expect(document.body.classList.contains('theme-midnight')).toBe(true)
  })

  it('normalises a legacy id before applying', () => {
    applyThemeToBody('dark')
    expect(document.body.classList.contains('theme-midnight')).toBe(true)
  })

  it('applies the default class for an unknown id', () => {
    applyThemeToBody('bogus')
    expect(document.body.classList.contains(`theme-${DEFAULT_THEME}`)).toBe(true)
  })

  it('adds the Tailwind dark class for the midnight theme', () => {
    applyThemeToBody('midnight')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('adds the dark class when the legacy "dark" alias is applied', () => {
    applyThemeToBody('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('removes the dark class when switching from midnight to a light theme', () => {
    applyThemeToBody('midnight')
    applyThemeToBody('sky')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('does not add the dark class for light themes', () => {
    applyThemeToBody('oatmeal')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

// Small consumer to observe + drive the provider.
function ThemeProbe() {
  const { theme, setTheme, themes } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="count">{themes.length}</span>
      <button onClick={() => setTheme('midnight')}>midnight</button>
      <button onClick={() => setTheme('dark')}>legacy-dark</button>
    </div>
  )
}

describe('ThemeProvider', () => {
  it('defaults a fresh visitor to the brand default theme', () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe(DEFAULT_THEME)
    expect(screen.getByTestId('count').textContent).toBe(String(THEMES.length))
  })

  it('restores a saved theme from localStorage', () => {
    localStorage.setItem(LS_KEY, 'sky')
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('sky')
  })

  it('normalises a legacy saved theme on load', () => {
    localStorage.setItem(LS_KEY, 'warm')
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe('oatmeal')
  })

  /* A device that last read in a retired palette still holds its id. There is
   * no CSS behind it any more, so an unmapped value is not a cosmetic problem
   * — it renders the learner a page with no palette at all. */
  it.each([
    ['lavender', 'sky'],
    ['vivid', 'solar'],
  ])('maps the retired %s theme to %s and rewrites the stored key', (retired, mapped) => {
    localStorage.setItem(LS_KEY, retired)
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe(mapped)
    // Rewritten, so the fallback fires once per device rather than on every
    // load — and anything reading the key directly (boot.js) sees a live id.
    expect(localStorage.getItem(LS_KEY)).toBe(mapped)
  })

  it('falls back to the default when the stored value is garbage', () => {
    localStorage.setItem(LS_KEY, 'purple-zebra')
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    expect(screen.getByTestId('theme').textContent).toBe(DEFAULT_THEME)
    expect(localStorage.getItem(LS_KEY)).toBe(DEFAULT_THEME)
  })

  it('setTheme updates state and persists to localStorage', () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    act(() => { screen.getByText('midnight').click() })
    expect(screen.getByTestId('theme').textContent).toBe('midnight')
    expect(localStorage.getItem(LS_KEY)).toBe('midnight')
  })

  it('setTheme normalises a legacy id before storing', () => {
    render(<ThemeProvider><ThemeProbe /></ThemeProvider>)
    act(() => { screen.getByText('legacy-dark').click() })
    expect(screen.getByTestId('theme').textContent).toBe('midnight')
    expect(localStorage.getItem(LS_KEY)).toBe('midnight')
  })
})

describe('useTheme', () => {
  it('throws when used outside a ThemeProvider', () => {
    // Silence the expected React error boundary console noise.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Bare() { useTheme(); return null }
    expect(() => render(<Bare />)).toThrow(/must be used inside ThemeProvider/)
    spy.mockRestore()
  })
})
