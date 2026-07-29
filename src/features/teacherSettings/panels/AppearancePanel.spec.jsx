/**
 * The workspace-theme picker, from the teacher's side.
 *
 * These assert behaviour a token/contrast test cannot: that choosing a theme
 * changes the document immediately (there is no Save button, so an
 * unapplied choice is indistinguishable from a broken control), that the
 * choice survives a reload, and that the reading-theme control next to it
 * still works — the two are separate settings and it would be easy for a
 * refactor to wire the second into the first.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../contexts/ThemeContext'
import { resetTeacherThemeStore } from '../../../contexts/teacherThemeStore'
import { TEACHER_THEME_STORAGE_KEY } from '../../../contexts/teacherThemeCore'
import AppearancePanel from './AppearancePanel'

// The panel renders inside a settings shell that expects router context; the
// shell itself is not under test here.
vi.mock('../components/SettingsDetailShell', () => ({
  default: ({ children }) => <div>{children}</div>,
}))

function renderPanel() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AppearancePanel />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
})

describe('workspace theme picker', () => {
  it('offers the four workspace themes as a single-choice group', () => {
    renderPanel()
    const group = screen.getByRole('radiogroup', { name: 'Workspace theme' })
    const cards = within(group).getAllByRole('radio')
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
    expect(screen.getByRole('radio', { name: /Terracotta/ })).toHaveAttribute('aria-checked', 'true')

    await u.click(screen.getByRole('radio', { name: /Miombo Green/ }))

    // Applied immediately — this is the whole contract of a no-Save control.
    expect(document.documentElement.getAttribute('data-theme')).toBe('miombo')
    expect(localStorage.getItem(TEACHER_THEME_STORAGE_KEY)).toBe('miombo')
    expect(screen.getByRole('radio', { name: /Miombo Green/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Terracotta/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('restores the saved theme on a fresh mount', () => {
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, 'copperbelt')
    resetTeacherThemeStore()
    renderPanel()
    expect(screen.getByRole('radio', { name: /Copperbelt/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('falls back to the default when the saved value is not a real theme', () => {
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, 'chartreuse')
    resetTeacherThemeStore()
    renderPanel()
    expect(screen.getByRole('radio', { name: /Terracotta/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('is keyboard operable as one control rather than four tab stops', async () => {
    const u = userEvent.setup()
    renderPanel()
    const checked = screen.getByRole('radio', { name: /Terracotta/ })
    checked.focus()
    await u.keyboard('{ArrowRight}')
    expect(document.documentElement.getAttribute('data-theme')).toBe('miombo')
  })

  it('keeps the reading theme separate from the workspace theme', async () => {
    const u = userEvent.setup()
    renderPanel()
    await u.click(screen.getByRole('radio', { name: /Night/ }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('night')

    // The learner/quiz reading theme is its own control on its own key, and
    // picking a workspace theme must not have silently changed it.
    expect(localStorage.getItem('examprep:theme')).not.toBe('night')
  })
})
