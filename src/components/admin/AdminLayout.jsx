import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Presentation,
  BookOpen,
  PencilLine,
  FolderOpen,
  BellRing,
  GraduationCap,
  TrendingUp,
  CreditCard,
  Home,
  Menu,
  X,
  LogOut,
  Sparkles,
  Users,
} from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import ThemeSelector from '../ui/ThemeSelector'
import Icon from '../ui/Icon'
import ErrorBoundary from '../ui/ErrorBoundary'

const NAV = [
  { to: '/admin',                        icon: LayoutDashboard, label: 'Dashboard',       end: true },
  { to: '/admin/learners',               icon: Users,           label: 'Learners'                  },
  { to: '/admin/lessons',                icon: Presentation,    label: 'Lessons'                   },
  { to: '/admin/lessons/new',            icon: BookOpen,        label: 'Create Lesson'             },
  { to: '/admin/generate/lesson-plan',   icon: Sparkles,        label: 'AI Lesson Plan'            },
  { to: '/admin/quizzes/new',            icon: PencilLine,      label: 'Create Quiz'               },
  { to: '/admin/content',                icon: FolderOpen,      label: 'Manage Content'            },
  { to: '/admin/approvals',              icon: BellRing,        label: 'Approvals'                 },
  { to: '/admin/teacher-applications',   icon: GraduationCap,   label: 'Teacher Apps'              },
  { to: '/admin/results',                icon: TrendingUp,      label: 'Results'                   },
  { to: '/admin/payments',               icon: CreditCard,      label: 'Payments'                  },
]

export default function AdminLayout({ children }) {
  const { logout, userProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  // Shared link style — desktop sidebar + mobile drawer stay in sync.
  // Active state shows a 3px left accent bar + accent-tinted bg so the
  // current page reads at a glance without scanning the icon.
  const navClass = ({ isActive }) =>
    `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all duration-fast ease-out ${
      isActive
        ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl pl-4'
        : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'
    }`
  const mobileNavClass = ({ isActive }) =>
    `relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-colors animate-slide-in-soft ${
      isActive ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl pl-5' : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'
    }`
  const ActiveBar = () => (
    <span
      aria-hidden
      className="absolute left-1 top-2 bottom-2 w-1 rounded-full theme-accent-fill"
    />
  )

  return (
    <div className="theme-bg theme-text min-h-screen flex">
      {/* ── Desktop Sidebar ─────────────────────────────── */}
      <aside className="theme-card theme-border shadow-elev-md hidden w-60 flex-shrink-0 flex-col border-r md:flex">
        {/* Logo */}
        <div className="theme-border px-4 py-5 border-b">
          <Link to="/admin" className="inline-flex">
            <Logo variant="full" size="md" />
          </Link>
          <div className="mt-2 flex items-center justify-between gap-2 pl-1">
            <p className="text-eyebrow theme-accent-text">Admin Panel</p>
            <ThemeSelector compact />
          </div>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-3 space-y-1">
          <Link
            to="/dashboard"
            className="theme-bg-subtle theme-text hover:theme-accent-bg hover:theme-accent-text flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-fast ease-out"
          >
            <Icon as={Home} size="sm" />
            Learner Dashboard
          </Link>
          <div className="theme-border my-2 border-t" />
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              {({ isActive }) => (
                <>
                  {isActive && <ActiveBar />}
                  <Icon as={item.icon} size="sm" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User info + Logout */}
        <div className="theme-border p-3 border-t">
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="theme-accent-fill theme-on-accent flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black shadow-elev-inner-hl">
              {(userProfile?.displayName || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="theme-text truncate text-xs font-black">{userProfile?.displayName || 'Admin'}</p>
              <p className="theme-text-muted truncate text-xs">{userProfile?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold text-danger hover:bg-danger-subtle transition-colors min-h-0"
          >
            <Icon as={LogOut} size="sm" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Mobile Header ───────────────────────────────── */}
      <div className="theme-card theme-border shadow-elev-md fixed left-0 right-0 top-0 z-40 border-b md:hidden backdrop-blur-md" style={{ backgroundColor: 'color-mix(in srgb, var(--card) 92%, transparent)' }}>
        <div className="flex items-center justify-between px-4 h-20">
          <Link to="/admin" className="flex items-center gap-2.5">
            <Logo variant="icon" size="md" />
            <span className="text-display-md theme-text" style={{ fontSize: 15 }}>Admin Panel</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSelector compact />
            <button
              onClick={() => setMobileOpen(o => !o)}
              aria-label={mobileOpen ? 'Close admin navigation' : 'Open admin navigation'}
              aria-expanded={mobileOpen}
              className="theme-text-muted hover:theme-bg-subtle min-h-0 rounded-lg p-2 transition-colors"
            >
              <Icon as={mobileOpen ? X : Menu} size="md" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile Drawer Overlay ────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />
          <nav
            className="theme-card theme-border absolute left-0 right-0 top-20 space-y-1 border-t p-3 shadow-elev-xl stagger"
            onClick={e => e.stopPropagation()}
          >
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="theme-bg-subtle theme-text hover:theme-accent-bg hover:theme-accent-text flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-colors animate-slide-in-soft"
            >
              <Icon as={Home} size="sm" />Learner Dashboard
            </Link>
            <div className="theme-border my-2 border-t" />
            {NAV.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={mobileNavClass}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <ActiveBar />}
                    <Icon as={item.icon} size="sm" />{item.label}
                  </>
                )}
              </NavLink>
            ))}
            <button
              onClick={handleLogout}
              className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-danger hover:bg-danger-subtle min-h-0 transition-colors"
            >
              <Icon as={LogOut} size="sm" />Sign Out
            </button>
          </nav>
        </div>
      )}

      {/* ── Main Content ────────────────────────────────── */}
      <main className="flex-1 min-w-0 md:pt-0 pt-20">
        {/* Single 1280px container — no per-route width gymnastics. Tables
            and dashboards have room to breathe; reading-heavy editors can
            opt into a narrower wrapper themselves. */}
        <div className="app-container py-6">
          {/* Route-keyed boundary: a render crash on one admin page no
              longer trashes the whole shell — the sidebar stays, and
              navigating to a different page clears the error. */}
          <ErrorBoundary inline resetKey={location.pathname}>
            {children}
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}
