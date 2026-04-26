import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderOpen,
  Presentation,
  PencilLine,
  BookOpen,
  Home,
  Menu,
  X,
  LogOut,
} from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import ThemeSelector from '../ui/ThemeSelector'
import Icon from '../ui/Icon'

const NAV = [
  { to: '/teacher',               icon: LayoutDashboard, label: 'My Dashboard', end: true },
  { to: '/teacher/content',       icon: FolderOpen,      label: 'My Content'              },
  { to: '/teacher/lessons',       icon: Presentation,    label: 'My Lessons'              },
  { to: '/teacher/quizzes/new',   icon: PencilLine,      label: 'Create Quiz'             },
  { to: '/teacher/lessons/new',   icon: BookOpen,        label: 'Create Lesson'           },
]

export default function TeacherLayout({ children }) {
  const { logout, userProfile } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

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
        <div className="theme-border px-4 py-5 border-b">
          <Link to="/teacher" className="inline-flex">
            <Logo variant="full" size="md" />
          </Link>
          <div className="mt-2 flex items-center justify-between gap-2 pl-1">
            <p className="text-eyebrow theme-accent-text">Teacher Panel</p>
            <ThemeSelector compact />
          </div>
        </div>

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

        <div className="theme-border p-3 border-t">
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="theme-accent-fill theme-on-accent flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black shadow-elev-inner-hl">
              {(userProfile?.displayName || 'T')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="theme-text truncate text-xs font-black">{userProfile?.displayName || 'Teacher'}</p>
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
          <Link to="/teacher" className="flex items-center gap-2.5">
            <Logo variant="icon" size="md" />
            <span className="text-display-md theme-text" style={{ fontSize: 15 }}>Teacher Panel</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeSelector compact />
            <button
              onClick={() => setMobileOpen(o => !o)}
              aria-label={mobileOpen ? 'Close teacher navigation' : 'Open teacher navigation'}
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
        <div className="app-container py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
