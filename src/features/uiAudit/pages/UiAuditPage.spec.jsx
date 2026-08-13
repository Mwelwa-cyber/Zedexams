/**
 * The UI audit page renders, and does so through the real theme mechanism.
 *
 * WHAT IS WORTH ASSERTING ON A QA PAGE
 * Not that it "looks right" — that is the job the page exists to do by eye,
 * and no assertion replaces it. What a test CAN pin is the three ways the page
 * could look fine and be lying:
 *
 *   1. A section throws and the page renders the other nine. On a page whose
 *      whole value is completeness, nine of ten is a silent lie — you scroll
 *      past the missing one and conclude those primitives are fine.
 *   2. The theme switcher drives a page-local copy of the theme state instead
 *      of the app's. It would still recolour the page, and would exercise a
 *      code path no user ever runs — so a bug in the real switch would be
 *      invisible here, on the one page built to find it.
 *   3. The side-by-side columns all render the same theme. Four identical
 *      columns look like "nothing breaks in any theme", which is the exact
 *      conclusion the mode is supposed to be able to disprove.
 *
 * The page is rendered inside the real ThemeProvider and ToastProvider, not
 * mocks, for the same reason the page itself is a route rather than a
 * Storybook story.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '../../../contexts/ThemeContext'
import { ToastProvider } from '../../../components/ui/Toast'
import { resetTeacherThemeStore } from '../../../contexts/teacherThemeStore'
import { TEACHER_THEMES } from '../../../contexts/teacherThemeCore'
import { AUDIT_SECTIONS } from '../lib/auditSections.js'
import UiAuditPage from './UiAuditPage.jsx'

/**
 * This file renders the ENTIRE shared component library, and in "All themes"
 * mode it renders it four times over — roughly 32 section instances in one
 * jsdom tree. That is the page's job, so the work is real rather than a hang,
 * and Vitest's 5s default is simply the wrong budget for it: the two
 * column-mode cases take ~2s on a warm laptop and blew straight past 5s on a
 * loaded CI runner, turning a green local suite red on main.
 *
 * A timeout tuned to the fastest machine that runs the suite is a timeout that
 * fails on the slowest one, so it is set generously here and stated rather
 * than nudged until CI stops complaining.
 */
vi.setConfig({ testTimeout: 30000 })

// jsdom has no layout engine, so getComputedStyle returns empty strings for
// custom properties and every swatch resolves to null. That is fine — the
// swatch VALUES are exactly the part a unit test cannot check and a human
// must. What is checked here is that the reader degrades to "—" rather than
// throwing, which is what would take the whole page down.
beforeEach(() => {
  localStorage.clear()
  resetTeacherThemeStore()
  document.documentElement.removeAttribute('data-theme')
  vi.stubGlobal(
    'requestAnimationFrame',
    /** @param {FrameRequestCallback} cb */ (cb) => {
      cb(0)
      return 1
    },
  )
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/dev/ui']}>
      <ThemeProvider>
        <ToastProvider>
          <UiAuditPage />
        </ToastProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('UiAuditPage', () => {
  it('renders every section in the registry — nine of ten is a silent lie', () => {
    renderPage()
    for (const [i, section] of AUDIT_SECTIONS.entries()) {
      // Matched as an exact string, not a regex built from the title: one of
      // the titles is "Navigation + chrome", and `+` is a quantifier — a
      // regex built from it silently matches something else.
      expect(
        screen.getByRole('heading', { name: `${i + 1} · ${section.title}` }),
        `section "${section.id}" did not render`,
      ).toBeInTheDocument()
    }
  })

  it('derives the jump-link nav from the same registry as the body', () => {
    renderPage()
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(AUDIT_SECTIONS.length)
    for (const [i, section] of AUDIT_SECTIONS.entries()) {
      expect(links[i]).toHaveAttribute('href', `#${section.id}`)
      // Every target must exist, or the link scrolls nowhere.
      expect(document.getElementById(section.id)).not.toBeNull()
    }
  })

  it('offers all four workspace themes', () => {
    renderPage()
    const group = screen.getByRole('group', { name: 'Workspace theme' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(
      TEACHER_THEMES.map((t) => t.label),
    )
  })

  it('switches themes through the app\'s own mechanism, not a local copy', async () => {
    const u = userEvent.setup()
    renderPage()

    // The real switch does three things a page-local one would not: sets the
    // attribute on <html>, persists to localStorage under the app's key, and
    // updates the pressed state from the shared store. Asserting the attribute
    // alone would pass for a reimplementation that also set it.
    expect(document.documentElement.getAttribute('data-theme')).toBe('terracotta')

    await u.click(screen.getByRole('button', { name: 'Night' }))

    expect(document.documentElement.getAttribute('data-theme')).toBe('night')
    expect(localStorage.getItem('zedexams-theme')).toBe('night')
    expect(screen.getByRole('button', { name: 'Night' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Terracotta' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('scopes the whole page so the workspace themes reach the shared primitives', () => {
    const { container } = renderPage()
    // Without .studio-theme the --zt-* tokens never reach the reading tokens
    // every primitive is written in, and three of the four themes would change
    // nothing below the toolbar.
    const scope = container.querySelector('[data-theme="terracotta"]')
    expect(scope).not.toBeNull()
    expect(scope).toHaveClass('studio-theme')
  })

  it('renders one scoped column per theme when All themes is on', () => {
    const { container } = renderPage()

    // fireEvent rather than userEvent: these two cases assert what the toggle
    // RENDERS, not the interaction semantics getting there (which the theme
    // switcher case above already covers). userEvent's pointer sequence and
    // per-event delay are pure overhead on the most expensive render in the
    // suite.
    fireEvent.click(screen.getByLabelText(/All themes side by side/i))

    const themed = AUDIT_SECTIONS.filter((s) => s.allThemes)
    for (const t of TEACHER_THEMES) {
      const columns = container.querySelectorAll(
        `[data-theme="${t.id}"].studio-theme`,
      )
      // One per themed section, plus the page scope itself for whichever
      // theme is currently live.
      const expected = t.id === 'terracotta' ? themed.length + 1 : themed.length
      expect(columns.length, `columns for ${t.id}`).toBe(expected)
    }
  })

  it('keeps section anchors unique in All themes mode', () => {
    renderPage()

    fireEvent.click(screen.getByLabelText(/All themes side by side/i))

    for (const section of AUDIT_SECTIONS) {
      // Four copies of a section would mean four elements sharing one id, and
      // every jump link would resolve to the leftmost column.
      expect(
        document.querySelectorAll(`#${section.id}`),
        `duplicate anchor for ${section.id}`,
      ).toHaveLength(1)
    }
  })

  it('survives a browser that reports no token values', () => {
    // getComputedStyle in jsdom returns '' for every custom property, so this
    // run IS the degraded case. The assertion is that the tokens section still
    // rendered rather than throwing on a null hex.
    renderPage()
    expect(
      screen.getByRole('heading', { name: /Design tokens/i }),
    ).toBeInTheDocument()
  })

  it('fires the real toast, which portals outside the theme scope', async () => {
    const u = userEvent.setup()
    const { container } = renderPage()

    await act(async () => {
      await u.click(screen.getByRole('button', { name: 'success' }))
    })

    const toast = await screen.findByText('Paper saved to your library.')
    expect(toast).toBeInTheDocument()
    // This is the finding the page is meant to surface, pinned so that a
    // future change which brings the toast inside the scope is noticed rather
    // than silently making a documented gap obsolete.
    expect(container.contains(toast)).toBe(false)
  })
})
