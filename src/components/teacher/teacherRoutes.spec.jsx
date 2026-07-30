/**
 * The guard that makes it hard to ship a teacher page outside the shared
 * shell.
 *
 * It iterates the REAL route table (TEACHER_ROUTES, which App.jsx maps into
 * <Route> elements) rather than a list written here — a hand-kept list would
 * simply not mention the page someone forgot to wrap, which is the exact
 * failure being guarded against.
 *
 * Each route is rendered for real. The page components are React.lazy, so
 * what actually mounts is the shell plus its Suspense fallback: the pages
 * themselves are not exercised here (they have their own specs) and none of
 * them needs to load for the question "is this inside TeacherLayout?" to be
 * answered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { TEACHER_ROUTES } from './teacherRoutes'

// Two components on this path boot Firebase for live usage data
// (useTeacherReminders / useTeacherUsage). Neither has any bearing on whether
// a route is inside the shell, and StudioGate — which pulls the second — sits
// INSIDE TeacherRoute, so stubbing it cannot mask a missing shell.
vi.mock('./TeacherTopBar', () => ({ default: () => <div data-testid="topbar" /> }))
vi.mock('../subscription/UsageReminderBanner', () => ({ default: () => null }))
vi.mock('../../contexts/NotificationContext', () => ({
  useNotifications: () => ({ unreadCount: 0, open: false, setOpen: () => {} }),
}))

const auth = {
  logout: vi.fn().mockResolvedValue(),
  loading: false,
  isAdmin: false,
  isTeacher: true,
  currentUser: { uid: 't1', displayName: 'Bwalya Chanda', email: 'bwalya@example.com', emailVerified: true },
  userProfile: { role: 'teacher', displayName: 'Bwalya Chanda', email: 'bwalya@example.com', teacherPlan: 'pro' },
}
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => auth,
  hasAuthSessionHint: () => true,
}))

/** Concrete path for a route pattern — :params filled with a stub id. */
function concretePath(pattern) {
  return pattern.replace(/:[A-Za-z0-9_]+/g, 'x1')
}

function renderRoute({ path, element }) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[concretePath(path)]}>
        <Suspense fallback={<div data-testid="outer-loading" />}>
          <Routes>
            <Route path={path} element={element} />
          </Routes>
        </Suspense>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

const shellRoutes = TEACHER_ROUTES.filter((r) => r.shell)
const exemptRoutes = TEACHER_ROUTES.filter((r) => !r.shell)

/* The shell is identified by the marker TeacherLayout puts on its root, not
   by the sidebar: below 768px the sidebar is legitimately unmounted, and a
   test that looked for it would report every teacher page as shell-less on a
   phone. */
const shellRoot = () => document.querySelector('[data-teacher-shell]')

describe('every teacher route renders inside TeacherLayout', () => {
  beforeEach(() => {
    auth.isAdmin = false
  })

  it('the table is not empty and is what App.jsx renders', () => {
    expect(shellRoutes.length).toBeGreaterThan(40)
  })

  it.each(shellRoutes.map((r) => [r.path, r]))('%s', async (_path, route) => {
    renderRoute(route)
    // TeacherLayout is itself lazy (it must not land in the entry chunk), so
    // wait for it rather than asserting on the first frame.
    await screen.findByTestId('teacher-shell')
    expect(shellRoot()).not.toBeNull()
    cleanup()
  })

  it('no shell-exempt route is exempt without saying why', () => {
    for (const route of exemptRoutes) {
      expect(route.shellExemptReason, `${route.path} has no shellExemptReason`).toBeTruthy()
      expect(route.shellExemptReason.length).toBeGreaterThan(30)
    }
  })

  /* The exemption list is checked from BOTH sides. Without this, marking a
     route `shell: false` would be a way to silence the guard rather than a
     statement about the route. */
  it.each(exemptRoutes.map((r) => [r.path, r]))(
    '%s is genuinely outside the shell, as declared',
    async (_path, route) => {
      renderRoute(route)
      // Nothing to await: these mount no shell. Give the lazy boundary a tick
      // so a shell that WAS being rendered would have appeared.
      await Promise.resolve()
      expect(shellRoot()).toBeNull()
      cleanup()
    },
  )

  it('every route path is unique', () => {
    const paths = TEACHER_ROUTES.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('every route lives under /teacher', () => {
    for (const { path } of TEACHER_ROUTES) {
      expect(path.startsWith('/teacher')).toBe(true)
    }
  })
})
