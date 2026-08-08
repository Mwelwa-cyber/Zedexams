import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import TeacherLayout from '../TeacherLayout'
import { SIDEBAR_COLLAPSE_KEY } from './sidebarCollapseCore'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

vi.mock('../TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isTeacher: true,
    isAdmin: false,
    currentUser: { email: 'teacher@example.com', displayName: 'Bwalya Mumba' },
    userProfile: null,
    logout: vi.fn(),
  }),
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

/* Same controllable matchMedia as responsiveNavigation.spec.jsx: jsdom has no
   layout, so viewport width is simulated. Both the mobile swap (max-width:767)
   and the rail default (max-width:1023) are evaluated against it. */
let viewportWidth = 1440
const listeners = new Set()
const realMatchMedia = window.matchMedia

function evaluate(query) {
  const max = query.match(/max-width:\s*([\d.]+)px/)
  const min = query.match(/min-width:\s*([\d.]+)px/)
  if (!max && !min) return false
  if (max && viewportWidth > parseFloat(max[1])) return false
  if (min && viewportWidth < parseFloat(min[1])) return false
  return true
}

function installMatchMedia() {
  window.matchMedia = (query) => {
    const remove = (cb) => {
      for (const l of listeners) if (l.cb === cb) listeners.delete(l)
    }
    return {
      media: query,
      get matches() { return evaluate(query) },
      onchange: null,
      addEventListener: (_t, cb) => listeners.add({ query, cb }),
      removeEventListener: (_t, cb) => remove(cb),
      addListener: (cb) => listeners.add({ query, cb }),
      removeListener: remove,
      dispatchEvent: () => false,
    }
  }
}

function setViewportWidth(width) {
  viewportWidth = width
  for (const { query, cb } of listeners) cb({ matches: evaluate(query), media: query })
}

beforeEach(() => {
  localStorage.clear()
  installMatchMedia()
  viewportWidth = 1440
})

afterEach(() => {
  listeners.clear()
  window.matchMedia = realMatchMedia
  delete document.documentElement.dataset.teacherSidebar
})

function renderShell() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/assessment-papers']}>
        <TeacherLayout>
          <div>page</div>
        </TeacherLayout>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const sidebar = () => document.querySelector('.tdv2-sidebar')
const shell = () => document.querySelector('.tdv2-shell')
const collapseButton = () => screen.queryByRole('button', { name: 'Collapse navigation' })
const expandButton = () => screen.queryByRole('button', { name: 'Expand navigation' })

describe('teacher sidebar — collapse toggle', () => {
  it('starts expanded on desktop and collapses to the rail on click', async () => {
    const user = userEvent.setup()
    renderShell()

    expect(sidebar()).toHaveClass('is-expanded')
    expect(shell()).not.toHaveClass('is-collapsed')

    await user.click(collapseButton())

    expect(sidebar()).toHaveClass('is-collapsed')
    // The shell column carries it too — that is what narrows the sidebar's
    // width and lets the main content take the freed space.
    expect(shell()).toHaveClass('is-collapsed')
    expect(expandButton()).toBeInTheDocument()

    await user.click(expandButton())
    expect(sidebar()).toHaveClass('is-expanded')
    expect(shell()).not.toHaveClass('is-collapsed')
  })

  it('keeps every nav item mounted and named when collapsed', async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(collapseButton())

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    for (const label of [
      'Dashboard', 'Lesson Plans', 'Schemes of Work', 'Weekly Focus', 'Record of Work',
      'My Library', 'Assessments', 'My Classes', 'Class List', 'Class Register',
      'Syllabi Studio', 'Curriculum', 'School Calendar', 'Subscription', 'Profile',
      'Settings', 'Help & Support',
    ]) {
      // Present in the accessibility tree, not just painted: the label is
      // visually hidden in the rail, never removed, so an icon-only link
      // still has a name.
      expect(nav.querySelector(`a[aria-label="${label}"]`) || screen.getByRole('link', { name: label }))
        .toBeTruthy()
    }
  })

  it('keeps the active item marked in the collapsed rail', async () => {
    const user = userEvent.setup()
    renderShell()

    const active = () => document.querySelector('.tdv2-nav-item.is-active')
    expect(active().textContent).toContain('Assessments')

    await user.click(collapseButton())

    // Same element, same is-active class (the gold pill) and same aria-current
    // — collapsing must not lose which page the teacher is on.
    expect(active()).not.toBeNull()
    expect(active().textContent).toContain('Assessments')
    expect(active().getAttribute('aria-current')).toBe('page')
  })

  it('shows a tooltip naming the item on hover, only while collapsed', async () => {
    const user = userEvent.setup()
    renderShell()

    const libraryLink = screen.getByRole('link', { name: 'My Library' })
    await user.hover(libraryLink)
    expect(document.querySelector('.tdv2-nav-tip')).toBeNull()

    await user.click(collapseButton())
    await user.hover(screen.getByRole('link', { name: 'My Library' }))

    const tip = document.querySelector('.tdv2-nav-tip')
    expect(tip).not.toBeNull()
    expect(tip.textContent).toBe('My Library')

    await user.unhover(screen.getByRole('link', { name: 'My Library' }))
    expect(document.querySelector('.tdv2-nav-tip')).toBeNull()
  })

  it('remembers the choice across a remount (reload / next page)', async () => {
    const user = userEvent.setup()
    const first = renderShell()
    await user.click(collapseButton())
    expect(localStorage.getItem(SIDEBAR_COLLAPSE_KEY)).toBe('collapsed')
    first.unmount()

    renderShell()
    expect(sidebar()).toHaveClass('is-collapsed')
    expect(shell()).toHaveClass('is-collapsed')
  })

  it('defaults to the rail on a tablet, and remembers an expand there', async () => {
    const user = userEvent.setup()
    viewportWidth = 900
    const first = renderShell()
    expect(sidebar()).toHaveClass('is-collapsed')

    await user.click(expandButton())
    expect(localStorage.getItem(SIDEBAR_COLLAPSE_KEY)).toBe('expanded')
    first.unmount()

    // The stored choice outranks the tablet default — the panel does not
    // snap back to a rail on the next page.
    renderShell()
    expect(sidebar()).toHaveClass('is-expanded')
  })

  it('follows the viewport only until the teacher has chosen', () => {
    renderShell()
    expect(sidebar()).toHaveClass('is-expanded')

    act(() => setViewportWidth(900))
    expect(sidebar()).toHaveClass('is-collapsed')

    act(() => setViewportWidth(1440))
    expect(sidebar()).toHaveClass('is-expanded')
  })

  it('leaves the mobile chrome untouched — no toggle, no sidebar, no stored state applied', () => {
    localStorage.setItem(SIDEBAR_COLLAPSE_KEY, 'collapsed')
    viewportWidth = 390
    renderShell()

    expect(sidebar()).toBeNull()
    expect(shell()).toBeNull()
    expect(collapseButton()).toBeNull()
    expect(expandButton()).toBeNull()
    expect(document.querySelector('.tdv2m-header')).not.toBeNull()
    expect(document.documentElement.dataset.teacherSidebar).toBeUndefined()
  })

  it('publishes the state on <html> for fixed chrome outside the shell', async () => {
    const user = userEvent.setup()
    const view = renderShell()
    expect(document.documentElement.dataset.teacherSidebar).toBe('expanded')

    await user.click(collapseButton())
    expect(document.documentElement.dataset.teacherSidebar).toBe('collapsed')

    view.unmount()
    expect(document.documentElement.dataset.teacherSidebar).toBeUndefined()
  })
})
