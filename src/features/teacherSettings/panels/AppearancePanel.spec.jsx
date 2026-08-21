/**
 * The two theme pickers on Settings -> Appearance, from the teacher's side.
 *
 * These assert behaviour a token/contrast test cannot: that choosing a theme
 * changes the document immediately (there is no Save button, so an unapplied
 * choice is indistinguishable from a broken control), that the choice
 * survives a reload, and that the two palettes stay on their own keys — it
 * would be easy for a refactor to wire one into the other.
 *
 * WHY BOTH ARE HERE, AND WHY THAT IS A REVERSAL
 * A teacher's pages are painted by two palettes: the workspace theme
 * (`--zt-*`, `data-theme` on <html>) inside TeacherLayout, and the reading
 * theme (`--bg`/`--card`/`--text`, `theme-<id>` on <body>) everywhere else —
 * the marketing site, sign-in, /papers, /pricing, /my-subscription, the note
 * reader, the quiz runner.
 *
 * The reading control was deleted from this page in 2026-07, and this file
 * pinned its absence, on the reasoning that it "colours nothing on this
 * screen". The premise is true and it is exactly what made it a trap:
 * `.studio-theme` remaps the reading tokens onto `--zt-*`, so this is the one
 * screen the palette is masked on. Measured in Chromium: with
 * `examprep:theme = 'midnight'` and no workspace theme stored, `/`, `/login`,
 * `/papers` and `/pricing` all render at body luminance 0.09 while
 * `data-theme` sits on the light default — so none of the four workspace
 * cards below could lift it, and <ReadingThemeSync> had already pushed the
 * palette to the account, which carries it to every browser the teacher signs
 * in from. The only remaining controls were the note-reader and quiz-runner
 * toolbars. That is the "site stuck on dark mode" report, and the absence
 * test is what would have let it come back.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider, useTheme } from '../../../contexts/ThemeContext'
import { resetTeacherThemeStore } from '../../../contexts/teacherThemeStore'
import { TEACHER_THEME_STORAGE_KEY } from '../../../contexts/teacherThemeCore'
import AppearancePanel from './AppearancePanel'

// The panel renders inside a settings shell that expects router context; the
// shell itself is not under test here.
vi.mock('../components/SettingsDetailShell', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

const capture = vi.fn()
vi.mock('../../../utils/analytics', () => ({ capture: (...args) => capture(...args) }))

/*
 * The live reading palette, read out of the provider.
 *
 * The panel deliberately does NOT paint <body> — <ThemeApplicator /> does,
 * from this value, and it is route-aware (it pins the brand default on the
 * two internal preview paths). So the panel's contract ends where this probe
 * reads: the provider moved, and the device recorded it. Asserting a body
 * class here would be asserting App.jsx's wiring from a component that has
 * none of it mounted.
 */
function ThemeProbe() {
  const { theme } = useTheme()
  return <output data-testid="live-reading-theme">{theme}</output>
}

const liveReadingTheme = () => screen.getByTestId('live-reading-theme').textContent

function renderPanel() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AppearancePanel />
        <ThemeProbe />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// Both controls are radiogroups now, and both carry a "Midnight"/"Night".
// Every query is scoped to its own group so a lookup can never be answered by
// the other palette's swatch — which is the exact confusion this page had.
const workspaceGroup = () => screen.getByRole('radiogroup', { name: 'Workspace theme' })
const readingGroup = () => screen.getByRole('radiogroup', { name: 'Reading theme' })
const workspaceOption = (name) => within(workspaceGroup()).getByRole('radio', { name })
const readingOption = (name) => within(readingGroup()).getByRole('radio', { name })

beforeEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
  document.documentElement.removeAttribute('data-theme')
  capture.mockClear()
})

afterEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
})

describe('workspace theme picker', () => {
  it('offers the four workspace themes as a single-choice group', () => {
    renderPanel()
    const cards = within(workspaceGroup()).getAllByRole('radio')
    expect(cards.map((c) => c.textContent)).toEqual([
      expect.stringContaining('Terracotta'),
      expect.stringContaining('Miombo Green'),
      expect.stringContaining('Copperbelt'),
      expect.stringContaining('Night'),
    ])
  })

  it('applies the chosen theme to the document and persists it', async () => {
    const u = userEvent.setup()
    renderPanel()

    // Terracotta is the default and is marked as the current choice.
    expect(workspaceOption(/Terracotta/)).toHaveAttribute('aria-checked', 'true')

    await u.click(workspaceOption(/Miombo Green/))

    // Applied immediately — this is the whole contract of a no-Save control.
    expect(document.documentElement.getAttribute('data-theme')).toBe('miombo')
    expect(localStorage.getItem(TEACHER_THEME_STORAGE_KEY)).toBe('miombo')
    expect(workspaceOption(/Miombo Green/)).toHaveAttribute('aria-checked', 'true')
    expect(workspaceOption(/Terracotta/)).toHaveAttribute('aria-checked', 'false')
  })

  it('restores the saved theme on a fresh mount', () => {
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, 'copperbelt')
    resetTeacherThemeStore()
    renderPanel()
    expect(workspaceOption(/Copperbelt/)).toHaveAttribute('aria-checked', 'true')
  })

  it('falls back to the default when the saved value is not a real theme', () => {
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, 'chartreuse')
    resetTeacherThemeStore()
    renderPanel()
    expect(workspaceOption(/Terracotta/)).toHaveAttribute('aria-checked', 'true')
  })

  it('is keyboard operable as one control rather than four tab stops', async () => {
    const u = userEvent.setup()
    renderPanel()
    const checked = workspaceOption(/Terracotta/)
    checked.focus()
    await u.keyboard('{ArrowRight}')
    expect(document.documentElement.getAttribute('data-theme')).toBe('miombo')
  })

  it('keeps the reading theme separate from the workspace theme', async () => {
    const u = userEvent.setup()
    renderPanel()
    await u.click(workspaceOption(/Night/))
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')

    // The learner/quiz reading theme is its own control on its own key, and
    // picking a workspace theme must not have silently changed it.
    expect(localStorage.getItem('examprep:theme')).not.toBe('night')
  })

  it('records the selection, and records nothing for merely arriving', async () => {
    const u = userEvent.setup()
    renderPanel()
    expect(capture).not.toHaveBeenCalled()

    await u.click(workspaceOption(/Copperbelt/))
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('workspace_theme_selected', {
      theme: 'copperbelt',
      previous_theme: 'terracotta',
    })

    // Re-picking the theme already in use is not a selection.
    await u.click(workspaceOption(/Copperbelt/))
    expect(capture).toHaveBeenCalledTimes(1)
  })
})

/*
 * The regression this panel exists to prevent, from the other side.
 *
 * A teacher signs in, the site is dark, they open the one page called
 * "Appearance", and there has to be something on it that can make the site
 * light again. Before this, there was not: the four cards above drive
 * `data-theme`, and a Midnight reading palette is on <body>.
 */
describe('reading theme picker', () => {
  it('offers the four reading palettes as their own single-choice group', () => {
    renderPanel()
    const swatches = within(readingGroup()).getAllByRole('radio')
    expect(swatches.map((s) => s.textContent)).toEqual([
      expect.stringContaining('Warm Oatmeal'),
      expect.stringContaining('Sky Blue'),
      expect.stringContaining('Solar Yellow'),
      expect.stringContaining('Midnight'),
    ])
  })

  it('applies the chosen palette immediately and persists it to the device', async () => {
    const u = userEvent.setup()
    renderPanel()

    await u.click(readingOption(/Midnight/))

    // Applied immediately — this is the whole contract of a no-Save control.
    expect(liveReadingTheme()).toBe('midnight')
    expect(localStorage.getItem('examprep:theme')).toBe('midnight')
    expect(readingOption(/Midnight/)).toHaveAttribute('aria-checked', 'true')
    expect(readingOption(/Warm Oatmeal/)).toHaveAttribute('aria-checked', 'false')
  })

  /*
   * THE BUG. A teacher arrives on a dark site because their account recorded
   * Midnight, and this page must be able to lift it. Nothing else in the
   * teacher portal can: `.studio-theme` masks the reading palette inside
   * TeacherLayout, so the workspace cards repaint this screen and no other.
   */
  it('lifts a dark reading palette a teacher arrived with', async () => {
    localStorage.setItem('examprep:theme', 'midnight')
    const u = userEvent.setup()
    renderPanel()

    expect(liveReadingTheme()).toBe('midnight')
    expect(readingOption(/Midnight/)).toHaveAttribute('aria-checked', 'true')

    await u.click(readingOption(/Warm Oatmeal/))

    expect(liveReadingTheme()).toBe('oatmeal')
    expect(localStorage.getItem('examprep:theme')).toBe('oatmeal')
    expect(readingOption(/Midnight/)).toHaveAttribute('aria-checked', 'false')
  })

  it('never touches the workspace theme or its key', async () => {
    const u = userEvent.setup()
    renderPanel()
    await u.click(readingOption(/Midnight/))

    // Terracotta is still the workspace answer: choosing a dark page to read
    // on is not a request to repaint the dashboard (readingThemeCore.js).
    expect(document.documentElement.getAttribute('data-theme')).toBe('terracotta')
    expect(localStorage.getItem(TEACHER_THEME_STORAGE_KEY)).toBeNull()
    expect(workspaceOption(/Terracotta/)).toHaveAttribute('aria-checked', 'true')
  })

  it('is keyboard operable as one control, like the workspace group', async () => {
    const u = userEvent.setup()
    renderPanel()
    readingOption(/Warm Oatmeal/).focus()
    await u.keyboard('{ArrowRight}')
    expect(liveReadingTheme()).toBe('sky')
  })

  it('records the selection under the same event the toolbars send', async () => {
    const u = userEvent.setup()
    renderPanel()

    await u.click(readingOption(/Sky Blue/))
    expect(capture).toHaveBeenCalledWith('reading_theme_selected', {
      theme: 'sky',
      previous_theme: 'oatmeal',
      surface: 'teacher_settings',
    })

    // Re-picking the palette already in use is not a selection.
    capture.mockClear()
    await u.click(readingOption(/Sky Blue/))
    expect(capture).not.toHaveBeenCalled()
  })
})
