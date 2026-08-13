import { Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { confirmShellNavigation, isPlainInAppLinkClick } from '../../shared/utils/shellNavGuardCore'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import TeacherTopBar from './TeacherTopBar'
import ErrorBoundary from '../ui/ErrorBoundary'
import PageLoader from '../ui/PageLoader'
import { isImmersiveStudioPath } from './immersiveStudioRoutes'
import Sidebar from './dashboardV2/Sidebar'
import LogoutDialog from './dashboardV2/LogoutDialog'
import { MobileHeader, MobileBottomNav, NavDrawer } from './dashboardV2/MobileChrome'
import { TEACHER_NAV_GROUPS } from './dashboardV2/dashboardV2Config'
import { teacherFromAuth } from './dashboardV2/dashboardV2Data'
import useDashboardTheme from './dashboardV2/useDashboardTheme'
import useIsMobile from '../../shared/hooks/useIsMobile'
import useSidebarCollapsed from './dashboardV2/useSidebarCollapsed'
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
  // Desktop/tablet only. The hook is still called on a phone (hooks are not
  // conditional) but nothing reads it there: the sidebar isn't mounted, so a
  // remembered collapse can't reach the mobile chrome.
  const { collapsed, toggleCollapsed } = useSidebarCollapsed()

  // Every route into a studio (sidebar, bottom nav, deep link) counts as a
  // "recently used" visit — not only taps on the dashboard launcher.
  useRecordStudioVisit()

  // A page (currently the Class Register) can register an unsaved-changes gate
  // via the module-scope shell-nav registry. The shell's own nav lives outside
  // that page's React context, so we intercept anchor navigations in the CAPTURE
  // phase — before React Router's <Link> handler runs — and cancel the ones the
  // gate refuses. A no-op when no page has an unsaved gate registered, which is
  // every teacher page but a dirty register.
  //
  // The exemption is by the `data-register-self-guarded` marker, NOT by <main>.
  // Only the register's OWN content (whose links already call guardLink) marks
  // itself, so gating it here too would double-prompt. Everything else is
  // gated — crucially including shared chrome that also renders inside <main>
  // (TeacherTopBar's Quick Create links), which an earlier `closest('main')`
  // exemption let slip through and discard unsaved marks.
  useEffect(() => {
    const onCaptureClick = (e) => {
      const anchor = e.target?.closest?.('a[href]')
      if (!anchor || anchor.closest('[data-register-self-guarded]')) return
      if (!isPlainInAppLinkClick(e, anchor, window.location.origin)) return
      if (!confirmShellNavigation()) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', onCaptureClick, true)
    return () => document.removeEventListener('click', onCaptureClick, true)
  }, [])

  // Publish the sidebar's state on <html> while the panel is mounted, for the
  // one piece of fixed chrome that has to clear it and lives outside this tree
  // (the dashboard-preview banner). Removed when the sidebar isn't there, so a
  // phone never inherits a desktop offset.
  useEffect(() => {
    const root = document.documentElement
    if (isMobile) {
      delete root.dataset.teacherSidebar
      return undefined
    }
    root.dataset.teacherSidebar = collapsed ? 'collapsed' : 'expanded'
    return () => { delete root.dataset.teacherSidebar }
  }, [isMobile, collapsed])

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

  // Logout is a <button>, not an anchor, so the capture listener above can't see
  // it — gate it here. Confirm the unsaved-marks discard BEFORE opening the
  // logout dialog, so a teacher signing out mid-edit is warned like any other
  // navigation away.
  function requestLogout() {
    if (confirmShellNavigation()) setLogoutOpen(true)
  }

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
             content.

             The panel collapses to a 76px icon rail from its own toggle, at
             every width it renders at. The rail is driven by `is-collapsed`
             on this column, not by a media query: the width only picks the
             DEFAULT (rail on a tablet, full panel on a desktop), and a
             teacher's stored choice outranks it. ────────────────────────── */}
      {!isMobile && (
        <div className={`tdv2 tdv2-shell ${collapsed ? 'is-collapsed' : ''} ${dark ? 'is-dark' : ''}`}>
          <Sidebar
            teacher={teacher}
            groups={groups}
            onRequestLogout={requestLogout}
            dark={dark}
            onToggleTheme={toggleTheme}
            collapsed={collapsed}
            onToggleCollapse={toggleCollapsed}
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
            onLogout={requestLogout}
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
