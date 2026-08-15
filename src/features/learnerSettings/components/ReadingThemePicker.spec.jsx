/**
 * The reading-theme picker, from the learner's side.
 *
 * These assert the things a token or CSS test cannot: that picking a theme
 * changes the document immediately (there is no Save button, so an unapplied
 * choice is indistinguishable from a broken control) and survives a reload on
 * the same device, and — the one that is easy to get wrong — that the
 * analytics event fires for a CHOICE and stays silent for a page load or a
 * retired-theme migration. An event that also fires on load turns every
 * session into a "selection" and makes the metric meaningless in a way nobody
 * notices.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, applyThemeToBody } from '../../../contexts/ThemeContext'
import ReadingThemePicker from './ReadingThemePicker'

const capture = vi.fn()
vi.mock('../../../utils/analytics', () => ({ capture: (...args) => capture(...args) }))

const LS_KEY = 'examprep:theme'

function renderPicker(surface = 'reader') {
  return render(
    <ThemeProvider>
      <ReadingThemePicker surface={surface} />
    </ThemeProvider>,
  )
}

// The provider owns state but the body class is applied by <ThemeApplicator />
// inside the router, which is not mounted here. Drive it from the stored value
// so the assertions are about what a real page would paint.
function paintedTheme() {
  applyThemeToBody(localStorage.getItem(LS_KEY))
  return [...document.body.classList].find((c) => c.startsWith('theme-'))
}

beforeEach(() => {
  localStorage.clear()
  document.body.className = ''
  capture.mockClear()
})

describe('ReadingThemePicker', () => {
  it('opens a popover offering the four reading themes', async () => {
    const u = userEvent.setup()
    renderPicker()
    expect(screen.queryByRole('dialog')).toBeNull()

    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    const group = screen.getByRole('radiogroup', { name: 'Reading theme' })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Warm Oatmeal'),
      expect.stringContaining('Sky Blue'),
      expect.stringContaining('Solar Yellow'),
      expect.stringContaining('Midnight'),
    ])
  })

  it('frames the device scope as a benefit rather than a limitation', async () => {
    const u = userEvent.setup()
    renderPicker()
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    expect(screen.getByRole('dialog').textContent).toContain('comfortable for your eyes')
  })

  it('applies the chosen theme immediately and persists it for the next load', async () => {
    const u = userEvent.setup()
    renderPicker()
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    await u.click(screen.getByRole('radio', { name: /Midnight/ }))

    expect(localStorage.getItem(LS_KEY)).toBe('midnight')
    expect(paintedTheme()).toBe('theme-midnight')
    // Choosing closes the popover — the page behind it is the confirmation.
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('restores the device choice on a fresh mount', async () => {
    const u = userEvent.setup()
    localStorage.setItem(LS_KEY, 'solar')
    renderPicker()
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    expect(screen.getByRole('radio', { name: /Solar Yellow/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('records the selection with the surface it was made on', async () => {
    const u = userEvent.setup()
    renderPicker('quiz')
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    await u.click(screen.getByRole('radio', { name: /Sky Blue/ }))

    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith('reading_theme_selected', {
      theme: 'sky',
      previous_theme: 'oatmeal',
      surface: 'quiz',
    })
  })

  it('emits nothing on load, and nothing for the retired-theme migration', async () => {
    const u = userEvent.setup()
    localStorage.setItem(LS_KEY, 'lavender')
    renderPicker()

    // The migration happened — but it is a repair, not a choice.
    expect(localStorage.getItem(LS_KEY)).toBe('sky')
    expect(capture).not.toHaveBeenCalled()

    // Merely opening the popover is not a selection either.
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    expect(capture).not.toHaveBeenCalled()

    // Re-picking the theme already in use changes nothing, so it is not one.
    await u.click(screen.getByRole('radio', { name: /Sky Blue/ }))
    expect(capture).not.toHaveBeenCalled()
  })

  it('is one keyboard control rather than four tab stops', async () => {
    const u = userEvent.setup()
    renderPicker()
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    screen.getByRole('radio', { name: /Warm Oatmeal/ }).focus()
    await u.keyboard('{ArrowRight}')
    expect(localStorage.getItem(LS_KEY)).toBe('sky')
  })

  it('closes on Escape without changing the theme', async () => {
    const u = userEvent.setup()
    renderPicker()
    await u.click(screen.getByRole('button', { name: 'Reading theme' }))
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    // No choice was made, so the key stays UNSET — an absent key is what lets
    // the prefers-color-scheme seeding keep following the OS. (Mounting used
    // to write the default here, which turned the seed into a saved choice.)
    expect(localStorage.getItem(LS_KEY)).toBeNull()
    // …and a real page would still paint the default palette.
    expect(paintedTheme()).toBe('theme-oatmeal')
  })
})
