import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  Home,
  BookOpen,
  PencilLine,
  BarChart3,
  Bot,
  GraduationCap,
  Settings,
  Menu,
  X,
  LogOut,
  Sparkles,
} from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import { getRoleLandingPath } from '../../utils/navigation'
import Logo from '../ui/Logo'
import ThemeSelector from '../ui/ThemeSelector'
import Icon from '../ui/Icon'
import MobileBottomNav from './MobileBottomNav'

export default function Navbar() {
  const { userProfile, logout, isAdmin, isTeacher } = useAuth()
  const { accessBadge } = useSubscription()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const homePath = getRoleLandingPath(userProfile)
  // Admins and teachers already see dedicated "Admin"/"Teacher" links below
  // that point to their role home — adding a "Home" link here would duplicate them.
  // Learners get a "Home" link that points to /dashboard.
  const navLinks = [
    ...(!isAdmin && !isTeacher ? [{ to: homePath, label: 'Home', icon: Home }] : []),
    { to: '/lessons',    label: 'Lessons',     icon: BookOpen },
    { to: '/quizzes',    label: 'Quizzes',     icon: PencilLine },
    { to: '/my-results', label: 'Results',     icon: BarChart3 },
    { to: '/study',      label: 'Zed',         icon: Bot },
  ]

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = (userProfile?.displayName || 'U')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  const badgeColors = {
    green:  'theme-accent-bg theme-accent-text theme-border',
    blue:   'theme-accent-bg theme-accent-text theme-border',
    yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    gray:   'theme-bg-subtle theme-text-muted theme-border',
  }
  const badgeClass = badgeColors[accessBadge.color] ?? badgeColors.gray

  // Shared link styles — extracted so desktop and mobile renders stay in sync.
  // Desktop active link gets a 2-px accent underline so the current section
  // reads at a glance without leaning solely on the tinted background.
  const linkClass = ({ isActive }) =>
    `relative flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-sm font-bold transition-all duration-fast ease-out ${
      isActive
        ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl after:absolute after:left-3 after:right-3 after:-bottom-[2px] after:h-[2px] after:rounded-full after:theme-accent-fill'
        : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'
    }`
  const mobileLinkClass = ({ isActive }) =>
    `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors animate-slide-in-soft ${
      isActive ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl pl-4 before:absolute before:left-1 before:top-2 before:bottom-2 before:w-1 before:rounded-full before:theme-accent-fill' : 'theme-text hover:theme-bg-subtle'
    }`

  return (
    <>
    <nav className="theme-card border-b theme-border shadow-elev-md sticky top-0 z-40 backdrop-blur-md" style={{ backgroundColor: 'color-mix(in srgb, var(--card) 92%, transparent)' }}>
      <div className="max-w-5xl mx-auto px-4 h-20 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link to={homePath} className="flex items-center min-h-0 flex-shrink-0">
          <Logo variant="full" size="md" />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {navLinks.map(l => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              <Icon as={l.icon} size="sm" />
              <span>{l.label}</span>
            </NavLink>
          ))}
          {(isTeacher && !isAdmin) && (
            <NavLink to="/teacher" className={linkClass}>
              <Icon as={GraduationCap} size="sm" />
              <span>Teacher</span>
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={linkClass}>
              <Icon as={Settings} size="sm" />
              <span>Admin</span>
            </NavLink>
          )}
        </div>

        {/* Right side — desktop */}
        <div className="hidden md:flex items-center gap-2 flex-shrink-0">
          {/* Access badge */}
          <span className={`inline-flex items-center gap-1 font-black text-xs px-2.5 py-1 rounded-full border ${badgeClass}`}>
            <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
          </span>

          {/* Theme selector */}
          <ThemeSelector compact />

          <div className="flex items-center gap-2 pl-2 border-l theme-border">
            <div className="theme-accent-fill theme-on-accent flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-black shadow-elev-inner-hl">
              {initials}
            </div>
            <div className="text-right hidden lg:block">
              <p className="theme-text font-black text-xs leading-tight truncate max-w-[100px]">
                {userProfile?.displayName ?? 'User'}
              </p>
              <p className="theme-text-muted text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
            </div>
            <button
              onClick={handleLogout}
              aria-label="Sign out"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-danger hover:bg-danger-subtle px-3 py-1.5 rounded-lg transition-colors min-h-0"
            >
              <Icon as={LogOut} size="xs" />
              Logout
            </button>
          </div>
        </div>

        {/* Mobile right — avatar + hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <ThemeSelector compact />
          <div className="theme-accent-fill theme-on-accent flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-black shadow-elev-inner-hl">
            {initials}
          </div>
          <button
            onClick={() => setOpen(o => !o)}
            aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={open}
            className="w-9 h-9 flex items-center justify-center theme-text-muted hover:theme-bg-subtle rounded-lg transition-colors min-h-0 bg-transparent shadow-none"
          >
            <Icon as={open ? X : Menu} size="md" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden border-t theme-border theme-card shadow-elev-lg animate-slide-up">
          <div className="max-w-5xl mx-auto px-4 py-3">
            {/* User info */}
            <div className="flex items-center gap-3 py-3 mb-2 border-b theme-border">
              <div className="theme-accent-fill theme-on-accent flex h-10 w-10 items-center justify-center rounded-full font-black shadow-elev-inner-hl">
                {initials}
              </div>
              <div>
                <p className="font-black theme-text text-sm">{userProfile?.displayName ?? 'User'}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <p className="theme-text-muted text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
                  {userProfile?.grade && <p className="theme-text-muted text-xs">· Grade {userProfile.grade}</p>}
                  <span className={`inline-flex items-center gap-1 text-xs font-black px-2 py-0.5 rounded-full border ${badgeClass}`}>
                    <Icon as={Sparkles} size="xs" strokeWidth={2.1} /> {accessBadge.label}
                  </span>
                </div>
              </div>
            </div>

            {/* Nav links — staggered entrance from the .stagger helper in index.css */}
            <div className="space-y-0.5 stagger">
              {navLinks.map(l => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  onClick={() => setOpen(false)}
                  className={mobileLinkClass}
                >
                  <Icon as={l.icon} size="md" className="w-6" />
                  {l.label}
                </NavLink>
              ))}
              {(isTeacher && !isAdmin) && (
                <NavLink to="/teacher" onClick={() => setOpen(false)} className={mobileLinkClass}>
                  <Icon as={GraduationCap} size="md" className="w-6" />
                  Teacher
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin" onClick={() => setOpen(false)} className={mobileLinkClass}>
                  <Icon as={Settings} size="md" className="w-6" />
                  Admin Panel
                </NavLink>
              )}
            </div>

            <div className="mt-3 pt-3 border-t theme-border">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-danger hover:bg-danger-subtle transition-colors min-h-0"
              >
                <Icon as={LogOut} size="md" className="w-6" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
    <MobileBottomNav />
    </>
  )
}
