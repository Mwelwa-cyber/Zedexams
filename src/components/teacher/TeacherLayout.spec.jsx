import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import TeacherLayout from './TeacherLayout'
import { setActiveShellNavGuard, __resetShellNavGuard } from './register/shellNavGuardCore'

function LocationSink() {
  const { pathname } = useLocation()
  return <div data-testid="loc">{pathname}</div>
}

// The shell's page-level chrome is exercised elsewhere; stub it so the spec
// focuses on the navigation.
vi.mock('./TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
// Exactly one navigation system is MOUNTED at a time (not CSS-hidden), so a
// spec has to say which viewport it is testing. jsdom reports no viewport, so
// drive the hook directly. The swap itself is covered end-to-end, across real
// breakpoints, in dashboardV2/responsiveNavigation.spec.jsx.
let mobile = false
vi.mock('./dashboardV2/useIsMobile', () => ({ default: () => mobile }))
// MobileHeader's bell reads the app-wide NotificationProvider (main.jsx).
vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

const logout = vi.fn().mockResolvedValue()
const auth = {
  logout,
  currentUser: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
  userProfile: { displayName: 'Bwalya Chanda', email: 'bwalya@example.com' },
  isAdmin: false,
}
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => auth,
}))

function renderLayout(path = '/teacher/library') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <TeacherLayout>
              <div>Page content</div>
            </TeacherLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TeacherLayout (V2 shell sidebar)', () => {
  beforeEach(() => {
    logout.mockClear()
    auth.isAdmin = false
    mobile = false
  })

  it('renders the shared V2 sidebar with the full teacher map, not the old Teacher Panel', () => {
    renderLayout()
    const sidebar = screen.getByLabelText('Teacher navigation')
    expect(screen.queryByText('Teacher Panel')).not.toBeInTheDocument()
    // Full-coverage destinations the dashboard's curated nav does not list
    for (const label of ['Weekly Focus', 'Record of Work', 'Class Register', 'School Calendar', 'Syllabi Studio', 'Curriculum']) {
      expect(within(sidebar).getByText(label)).toBeInTheDocument()
    }
    // V2 settings group + page content still render
    expect(within(sidebar).getByText('Help & Support')).toBeInTheDocument()
    expect(screen.getByText('Page content')).toBeInTheDocument()
    // No Admin Panel entry for regular teachers
    expect(within(sidebar).queryByText('Admin Panel')).not.toBeInTheDocument()
  })

  it('marks the current section active', () => {
    renderLayout('/teacher/library')
    const active = screen.getByRole('link', { name: /My Library/ })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('logging out asks for confirmation first', async () => {
    const user = userEvent.setup()
    renderLayout()
    await user.click(screen.getByRole('button', { name: /Bwalya Chanda/ }))
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }))
    expect(logout).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: 'Log out of ZedExams?' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /Log out/ }))
    expect(logout).toHaveBeenCalledTimes(1)
  })

  it('admins get the Admin Panel shortcut at the top', () => {
    auth.isAdmin = true
    renderLayout()
    const sidebar = screen.getByLabelText('Teacher navigation')
    expect(within(sidebar).getByText('Admin Panel')).toBeInTheDocument()
  })

  describe('shell-nav unsaved guard', () => {
    afterEach(() => __resetShellNavGuard())

    function renderWithSink(path = '/teacher/attendance') {
      return render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="*" element={<TeacherLayout><LocationSink /></TeacherLayout>} />
          </Routes>
        </MemoryRouter>,
      )
    }

    it('a registered dirty gate that DENIES blocks a shell sidebar navigation', async () => {
      const user = userEvent.setup()
      const gate = vi.fn(() => false) // teacher declines "leave without saving?"
      setActiveShellNavGuard(gate)
      renderWithSink('/teacher/attendance')
      expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/attendance')

      await user.click(screen.getByRole('link', { name: /My Library/ }))
      // The capture listener consulted the gate and cancelled the SPA navigation.
      expect(gate).toHaveBeenCalled()
      expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/attendance')
    })

    it('no registered gate → shell navigation proceeds as normal', async () => {
      const user = userEvent.setup()
      renderWithSink('/teacher/attendance')
      await user.click(screen.getByRole('link', { name: /My Library/ }))
      expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/library')
    })

    it('a gate that ALLOWS lets the shell navigation through', async () => {
      const user = userEvent.setup()
      setActiveShellNavGuard(() => true) // teacher accepts the discard
      renderWithSink('/teacher/attendance')
      await user.click(screen.getByRole('link', { name: /My Library/ }))
      expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/library')
    })

    it('gates shared chrome INSIDE <main> (TeacherTopBar-style) but exempts register-owned content', async () => {
      const user = userEvent.setup()
      setActiveShellNavGuard(() => false)
      render(
        <MemoryRouter initialEntries={['/teacher/register/c1']}>
          <Routes>
            <Route path="*" element={
              <TeacherLayout>
                {/* Shared chrome rendered inside <main> — NOT register-owned.
                    The old closest('main') exemption let this slip through. */}
                <Link to="/teacher/library" data-testid="shared">Shared</Link>
                {/* The register's own content marks itself; its links already
                    call guardLink, so the capture listener must NOT re-gate it. */}
                <div data-register-self-guarded>
                  <Link to="/teacher/register/c1/attendance" data-testid="owned">Owned</Link>
                </div>
                <LocationSink />
              </TeacherLayout>
            } />
          </Routes>
        </MemoryRouter>,
      )
      // Shared in-<main> link is gated → navigation cancelled.
      await user.click(screen.getByTestId('shared'))
      expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/register/c1')
      // Register-owned link is exempt from the capture listener → proceeds.
      await user.click(screen.getByTestId('owned'))
      expect(screen.getByTestId('loc')).toHaveTextContent('/teacher/register/c1/attendance')
    })
  })

  it('renders the V2 mobile chrome: header, bottom nav, and a drawer with the full map', async () => {
    const user = userEvent.setup()
    mobile = true
    renderLayout()
    // V2 mobile header + bottom nav replace the old glass header + tab bar
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument()
    const bottom = screen.getByRole('navigation', { name: 'Quick navigation' })
    expect(within(bottom).getByText('Home')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    const drawerRoot = document.querySelector('.tdv2m-drawer-root')
    expect(drawerRoot).toHaveClass('is-open')
    // The drawer carries the same full teacher map as the desktop panel
    const drawer = within(screen.getByRole('dialog', { name: 'Navigation' }))
    expect(drawer.getByText('School Calendar')).toBeInTheDocument()
    expect(drawer.getByText('Class Register')).toBeInTheDocument()
  })
})
