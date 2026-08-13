import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { TeacherLayout } from '../../teacherShell'
import TeacherDashboardV2 from '../pages/TeacherDashboardV2'
import { TOUR_STORAGE_KEY } from '../lib/onboardingTourCore'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

// These specs exercise the responsive DOM swap — suppress the first-run tour
// (its own behaviour is covered in OnboardingTour.spec.jsx).
beforeEach(() => {
  localStorage.setItem(TOUR_STORAGE_KEY, 'done')
})

// The shell's studio top bar reads Firestore (useTeacherReminders); it is not
// part of the navigation under test and never renders in the dashboard
// variant anyway, so stub the module rather than boot Firebase.
vi.mock('../../teacherShell/components/TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
// The mobile header bell reads the app-wide NotificationProvider (main.jsx);
// specs mount without it, so stub the hook.
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    isTeacher: true, isAdmin: false, currentUser: null, userProfile: null, logout: vi.fn(),
  }),
}))
vi.mock('../../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

/**
 * Controllable window.matchMedia: evaluates (max-width)/(min-width) queries
 * against a mutable viewport width and fires registered change listeners
 * when setViewportWidth crosses a breakpoint — jsdom has no real layout, so
 * this is how a phone rotation / window resize is simulated.
 */
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

function installMatchMedia({ legacyListenersOnly = false } = {}) {
  window.matchMedia = (query) => {
    const entry = (cb) => ({ query, cb })
    const remove = (cb) => {
      for (const l of listeners) if (l.cb === cb) listeners.delete(l)
    }
    const mql = {
      media: query,
      get matches() {
        return evaluate(query)
      },
      onchange: null,
      addListener: (cb) => listeners.add(entry(cb)),
      removeListener: remove,
      dispatchEvent: () => false,
    }
    if (!legacyListenersOnly) {
      // Modern API. When legacyListenersOnly is set these stay undefined,
      // mimicking Safari < 14 — the hook must fall back, not throw.
      mql.addEventListener = (_type, cb) => listeners.add(entry(cb))
      mql.removeEventListener = (_type, cb) => remove(cb)
    }
    return mql
  }
}

function setViewportWidth(width) {
  viewportWidth = width
  for (const { query, cb } of listeners) {
    cb({ matches: evaluate(query), media: query })
  }
}

afterEach(() => {
  listeners.clear()
  window.matchMedia = realMatchMedia
})

// The navigation under test belongs to TeacherLayout, not to the dashboard —
// which is the point: these guarantees now hold for every teacher page, not
// just this one. The dashboard is rendered inside it exactly as the route does.
function renderDashboard() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/teacher/dashboard-preview']}>
        <TeacherLayout variant="dashboard">
          <TeacherDashboardV2 />
        </TeacherLayout>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const desktopSidebar = () => document.querySelector('.tdv2-sidebar')
const bottomNav = () => document.querySelector('.tdv2m-dockbar')
const mobileHeader = () => document.querySelector('.tdv2m-header')

// The task's regression matrix: portrait phones, small landscape/tablet,
// tablet landscape, desktop.
const MOBILE_VIEWPORTS = [
  [320, 568],
  [360, 800],
  [390, 844],
  [412, 915],
]
const DESKTOP_VIEWPORTS = [
  [768, 1024],
  [1024, 768],
  [1440, 900],
]

describe('responsive navigation — one nav system at a time', () => {
  it.each(MOBILE_VIEWPORTS)(
    '%ix%i: no desktop sidebar, mobile bottom nav + header render',
    (width) => {
      installMatchMedia()
      viewportWidth = width
      renderDashboard()

      // The desktop sidebar must be absent from the DOM — not hidden,
      // not translated off-screen, absent.
      expect(desktopSidebar()).toBeNull()
      expect(screen.queryByLabelText('Teacher navigation')).not.toBeInTheDocument()

      // Mobile chrome: the floating dock's four destinations + the separate
      // Quick Create button + compact header.
      expect(mobileHeader()).not.toBeNull()
      const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
      for (const label of ['Home', 'Register', 'Library', 'Assessments']) {
        expect(nav.textContent).toContain(label)
      }
      expect(screen.getByRole('button', { name: 'Quick create' })).toBeInTheDocument()

      // The shell mounts no sidebar scope at all, so no sidebar column can
      // reserve space even before CSS media queries apply.
      expect(document.querySelector('.tdv2-shell')).toBeNull()
    },
  )

  it.each(DESKTOP_VIEWPORTS)(
    '%ix%i: desktop sidebar renders, mobile chrome absent',
    (width) => {
      installMatchMedia()
      viewportWidth = width
      renderDashboard()

      expect(screen.getByLabelText('Teacher navigation')).toBeInTheDocument()
      expect(bottomNav()).toBeNull()
      expect(mobileHeader()).toBeNull()
      expect(document.querySelector('.tdv2-mchrome')).toBeNull()
    },
  )

  it('active bottom-nav item is marked with aria-current, not colour alone', () => {
    installMatchMedia()
    viewportWidth = 390
    renderDashboard()
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' })
    const active = nav.querySelector('[aria-current="page"]')
    expect(active).not.toBeNull()
    expect(active.textContent).toContain('Home')
  })

  it('rotating phone → landscape/desktop swaps to the sidebar with no stale mobile chrome', () => {
    installMatchMedia()
    viewportWidth = 390
    renderDashboard()
    expect(desktopSidebar()).toBeNull()
    expect(bottomNav()).not.toBeNull()

    act(() => setViewportWidth(1024))

    expect(screen.getByLabelText('Teacher navigation')).toBeInTheDocument()
    expect(bottomNav()).toBeNull()
    expect(mobileHeader()).toBeNull()
  })

  it('resizing desktop → phone removes the sidebar and mounts the mobile chrome', () => {
    installMatchMedia()
    viewportWidth = 1440
    renderDashboard()
    expect(desktopSidebar()).not.toBeNull()

    act(() => setViewportWidth(390))

    expect(desktopSidebar()).toBeNull()
    expect(screen.queryByLabelText('Teacher navigation')).not.toBeInTheDocument()
    expect(bottomNav()).not.toBeNull()
    expect(document.querySelector('.tdv2-shell')).toBeNull()
  })

  it('legacy MediaQueryList (no addEventListener, Safari < 14) still gets the mobile IA and live updates', () => {
    // Regression guard for the crash path that left phones on the desktop
    // layout: mql.addEventListener was called unconditionally and threw.
    installMatchMedia({ legacyListenersOnly: true })
    viewportWidth = 390
    renderDashboard()

    expect(desktopSidebar()).toBeNull()
    expect(bottomNav()).not.toBeNull()

    act(() => setViewportWidth(1024))
    expect(screen.getByLabelText('Teacher navigation')).toBeInTheDocument()
    expect(bottomNav()).toBeNull()
  })
})
