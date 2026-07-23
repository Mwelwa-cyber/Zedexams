import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import TeacherTopBar from './TeacherTopBar'
import ErrorBoundary from '../ui/ErrorBoundary'
import { isImmersiveStudioPath } from './immersiveStudioRoutes'
import Sidebar from './dashboardV2/Sidebar'
import LogoutDialog from './dashboardV2/LogoutDialog'
import { MobileHeader, MobileBottomNav, NavDrawer } from './dashboardV2/MobileDashboardView'
import { STUDIO_NAV_GROUPS } from './dashboardV2/dashboardV2Config'
import { teacherFromAuth } from './dashboardV2/dashboardV2Data'
import useDashboardTheme from './dashboardV2/useDashboardTheme'
import useRecordStudioVisit from './dashboardV2/launcher/useRecordStudioVisit'
import './dashboardV2/dashboardV2.css'

export default function TeacherLayout({ children }) {
  const { logout, currentUser, userProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { dark, toggleTheme } = useDashboardTheme()

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
    if (!isAdmin) return STUDIO_NAV_GROUPS
    const [root, ...rest] = STUDIO_NAV_GROUPS
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
    await logout()
    navigate('/login')
  }

  return (
    <div className="studio-theme theme-bg theme-text min-h-screen flex">
      {/* ── Desktop Sidebar (lg+) — the same V2 panel as /teacher, carrying
             the full teacher map (STUDIO_NAV_GROUPS). Scoped under .tdv2 so
             the dashboard design system styles the panel without leaking
             into the page content. ─────────────────────────── */}
      <div className={`tdv2 tdv2-shell ${dark ? 'is-dark' : ''}`}>
        <Sidebar
          teacher={teacher}
          groups={groups}
          onRequestLogout={() => setLogoutOpen(true)}
          dark={dark}
          onToggleTheme={toggleTheme}
        />
      </div>

      {/* ── Mobile + tablet chrome (< lg) — same V2 header, slide-out drawer
             and bottom nav as the dashboard, over the same breakpoint range
             the old glass header + tab bar covered. ─────────────────── */}
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
        {!isImmersiveStudioPath(pathname) && (
          <MobileBottomNav drawerOpen={drawerOpen} onMore={() => setDrawerOpen(true)} />
        )}
      </div>

      {/* ── Main Content ────────────────────────────────── */}
      <main className="flex-1 min-w-0 pt-[calc(5rem+env(safe-area-inset-top))] lg:pt-0">
        <div className="studio-shell py-6 pb-24 lg:pb-6">
          {/* The dashboard ships its own universal search below the hero (the
              redesign), so the global top search/quick-create bar is hidden
              there to avoid a duplicate. Other studio pages keep it. */}
          {pathname !== '/teacher' && <TeacherTopBar />}
          <ErrorBoundary inline resetKey={pathname}>
            {children}
          </ErrorBoundary>
        </div>
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
