import { Suspense, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import TeacherTopBar from './TeacherTopBar'
import ErrorBoundary from '../ui/ErrorBoundary'
import PageLoader from '../ui/PageLoader'
import { isImmersiveStudioPath } from './immersiveStudioRoutes'
import Sidebar from './dashboardV2/Sidebar'
import LogoutDialog from './dashboardV2/LogoutDialog'
import { MobileHeader, MobileBottomNav, NavDrawer } from './dashboardV2/MobileDashboardView'
import { TEACHER_NAV_GROUPS } from './dashboardV2/dashboardV2Config'
import { teacherFromAuth } from './dashboardV2/dashboardV2Data'
import useDashboardTheme from './dashboardV2/useDashboardTheme'
import useIsMobile from './dashboardV2/useIsMobile'
import useRecordStudioVisit from './dashboardV2/launcher/useRecordStudioVisit'
import './dashboardV2/dashboardV2.css'

/**
 * Suspense boundary INSIDE the shell, so a page chunk still downloading
 * suspends only the page well. App.jsx's boundary is outside the layout, so
 * without this every navigation between teacher pages blanks the sidebar to
 * a full-screen loader and paints it back — the shell would be "shared" in
 * source and still flicker like two shells on screen.
 */
function PageContent({ children }) {
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>
}

/**
 * The one shell for the whole teacher area — sidebar, mobile chrome, account
 * menu and logout — with an outlet for page content. Every /teacher/* route
 * renders inside it (guarded by teacherRoutes.spec.jsx), including the
 * dashboard, which used to bring its own copy of this chrome.
 *
 * `variant` selects the content container only, never the chrome:
 *   • 'studio'    — the standard page well (.studio-shell) plus the global
 *                   search/quick-create bar.
 *   • 'dashboard' — the page owns its own grid (.tdv2-main/.tdv2-content) and
 *                   header, so the shell supplies the design-system scope and
 *                   otherwise gets out of the way.
 * A page choosing its own inner layout is normal; a page choosing its own
 * NAVIGATION is the thing this component exists to prevent.
 */
export default function TeacherLayout({ children, variant = 'studio' }) {
  const { logout, currentUser, userProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { dark, toggleTheme } = useDashboardTheme()
  // ONE navigation system is mounted at a time — the other is absent from the
  // DOM, not hidden, not moved off-screen. The CSS rules that also hide each
  // at the wrong width are a backstop for the frame where this state could be
  // stale (first paint, mid-rotate), never the mechanism.
  const isMobile = useIsMobile()

  // Every route into a studio (sidebar, bottom nav, deep link) counts as a
  // "recently used" visit — not only taps on the dashboard launcher.
  useRecordStudioVisit()

  const teacher = teacherFromAuth({
    displayName: userProfile?.displayName || currentUser?.displayName,
    email: userProfile?.email || currentUser?.email,
  })

  // Same full teacher map for everyone; admins get an extra jump back to the
  // admin panel at the top (the old Teacher Panel had the same shortcut).
  const groups = useMemo(() => {
    if (!isAdmin) return TEACHER_NAV_GROUPS
    const [root, ...rest] = TEACHER_NAV_GROUPS
    return [
      {
        ...root,
        items: [
          { id: 'admin', label: 'Admin Panel', icon: ShieldCheck, to: '/admin' },
          ...root.items,
        ],
      },
      ...rest,
    ]
  }, [isAdmin])

  async function confirmLogout() {
    setLogoutOpen(false)
    try {
      await logout()
    } catch {
      // A failed sign-out must not send the teacher to /login while still
      // signed in — that reads as "logged out" and isn't.
      return
    }
    navigate('/login')
  }

  return (
    <div
      className="studio-theme theme-bg theme-text min-h-screen flex"
      // The marker teacherRoutes.spec.jsx looks for. Deliberately NOT the
      // sidebar: below 768px the sidebar is legitimately unmounted, so keying
      // the guard to it would report every teacher page as shell-less on a
      // phone.
      data-testid="teacher-shell"
      data-teacher-shell=""
    >
      {/* ── Desktop sidebar (≥768px) — the V2 panel carrying the one teacher
             map (TEACHER_NAV_GROUPS). Scoped under .tdv2 so the dashboard
             design system styles the panel without leaking into the page
             content. 768–1023px renders it as the compact icon rail (CSS);
             the full panel returns at 1024px. ─────────────────────────── */}
      {!isMobile && (
        <div className={`tdv2 tdv2-shell ${dark ? 'is-dark' : ''}`}>
          <Sidebar
            teacher={teacher}
            groups={groups}
            onRequestLogout={() => setLogoutOpen(true)}
            dark={dark}
            onToggleTheme={toggleTheme}
          />
        </div>
      )}

      {/* ── Mobile chrome (< 768px) — header, slide-out drawer and floating
             dock. The cut-over is 768px, the same point the sidebar appears,
             so a teacher never sees BOTH or NEITHER. It used to be 1024px
             here and 768px on the dashboard, which is why an iPad showed the
             dashboard an icon rail and every studio page a bottom dock. ── */}
      {isMobile && (
        <div className={`tdv2 tdv2-bare tdv2-mchrome ${dark ? 'is-dark' : ''}`}>
          <MobileHeader drawerOpen={drawerOpen} onOpenMenu={() => setDrawerOpen(true)} />
          <NavDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            teacher={teacher}
            groups={groups}
            dark={dark}
            onToggleTheme={toggleTheme}
            onLogout={() => setLogoutOpen(true)}
          />
          {/* Suppressed inside the full-screen assessment studio, which renders
              its own fixed bottom dock (.sv-dock) — two stacked bars collide. */}
          {!isImmersiveStudioPath(pathname) && <MobileBottomNav />}
        </div>
      )}

      {/* ── Main content ────────────────────────────────── */}
      <main className="flex-1 min-w-0 pt-[calc(5rem+env(safe-area-inset-top))] md:pt-0">
        {variant === 'dashboard' ? (
          // The dashboard renders its own header and grid. It still needs a
          // .tdv2 scope for the design-system variables, but not the grid or
          // background the bare scope drops.
          <div className={`tdv2 tdv2-bare tdv2-page ${dark ? 'is-dark' : ''}`}>
            <ErrorBoundary inline resetKey={pathname}>
              <PageContent>{children}</PageContent>
            </ErrorBoundary>
          </div>
        ) : (
          <div className="studio-shell py-6 pb-24 md:pb-6">
            <TeacherTopBar />
            <ErrorBoundary inline resetKey={pathname}>
              <PageContent>{children}</PageContent>
            </ErrorBoundary>
          </div>
        )}
      </main>

      {/* Logout confirmation lives in its own always-mounted scope: the shell
          and mobile-chrome scopes are display:none at the opposite breakpoint,
          which would hide the fixed overlay with them. */}
      {logoutOpen ? (
        <div className={`tdv2 tdv2-bare ${dark ? 'is-dark' : ''}`}>
          <LogoutDialog onCancel={() => setLogoutOpen(false)} onConfirm={confirmLogout} />
        </div>
      ) : null}
    </div>
  )
}
