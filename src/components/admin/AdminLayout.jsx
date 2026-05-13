import { useState, useEffect, useCallback } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Presentation,
  BookOpen,
  PencilLine,
  FolderOpen,
  BellRing,
  TrendingUp,
  CreditCard,
  Home,
  Menu,
  X,
  LogOut,
  Users,
  GraduationCap,
  Settings,
  Bot,
  FileText,
  Sparkles,
  Upload,
  ShieldCheck,
  Bell,
  ChartBarIcon,
  Search,
  ChevronDown,
  Eye,
} from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import Icon from '../ui/Icon'
import ErrorBoundary from '../ui/ErrorBoundary'
import ThemeSelector from '../ui/ThemeSelector'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import CommandPalette from './CommandPalette'

// Grouped navigation. Each entry can carry a `badgeKey` referencing the
// `badges` map computed below (pending counts), so admins can see how
// much is waiting in approvals + agent queue without leaving the page.
const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/admin/analytics', icon: ChartBarIcon, label: 'Analytics' },
    ],
  },
  {
    label: 'Users',
    items: [
      { to: '/admin/users', icon: Users, label: 'All users' },
      { to: '/admin/learners', icon: GraduationCap, label: 'Learners' },
      { to: '/admin/teachers', icon: GraduationCap, label: 'Teachers' },
      { to: '/admin/admins', icon: ShieldCheck, label: 'Admins' },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/admin/content', icon: FolderOpen, label: 'Manage content' },
      { to: '/admin/quizzes/new', icon: PencilLine, label: 'Create quiz' },
      { to: '/admin/lessons', icon: Presentation, label: 'Notes Studio' },
      { to: '/admin/lessons/new', icon: BookOpen, label: 'Create note' },
      { to: '/admin/papers', icon: FileText, label: 'Past papers' },
      { to: '/admin/import/csv', icon: Upload, label: 'CSV import' },
      { to: '/admin/cbc-kb', icon: BookOpen, label: 'CBC KB' },
      { to: '/admin/games-seed', icon: Sparkles, label: 'Games seed' },
    ],
  },
  {
    label: 'Approvals',
    items: [
      { to: '/admin/approvals', icon: BellRing, label: 'Content queue', badgeKey: 'content' },
      { to: '/admin/agents', icon: Bot, label: 'AI agents', badgeKey: 'agents' },
      { to: '/admin/generations', icon: Sparkles, label: 'AI generations' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { to: '/admin/results', icon: TrendingUp, label: 'Results' },
      { to: '/admin/ai-costs', icon: TrendingUp, label: 'AI costs' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/admin/payments', icon: CreditCard, label: 'Payments', badgeKey: 'payments' },
      { to: '/admin/demo-trials', icon: Sparkles, label: 'Demo trials' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admin/settings', icon: Settings, label: 'Settings' },
      { to: '/admin/announcements', icon: Bell, label: 'Announcements' },
      { to: '/admin/activity', icon: ShieldCheck, label: 'Activity log' },
    ],
  },
]

const VIEW_AS_KEY = 'zedexams.adminViewAs'

function useAdminBadges() {
  const [badges, setBadges] = useState({ content: 0, agents: 0, payments: 0 })
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [pendingQuiz, pendingLesson, awaitingApproval, pendingPayments] = await Promise.all([
          getCountFromServer(query(collection(db, 'quizzes'), where('status', '==', 'pending'))).catch(() => null),
          getCountFromServer(query(collection(db, 'lessons'), where('status', '==', 'pending'))).catch(() => null),
          getCountFromServer(query(collection(db, 'agentJobs'), where('status', '==', 'awaiting_approval'))).catch(() => null),
          getCountFromServer(query(collection(db, 'payments'), where('status', '==', 'pending'))).catch(() => null),
        ])
        if (cancelled) return
        setBadges({
          content: (pendingQuiz?.data()?.count ?? 0) + (pendingLesson?.data()?.count ?? 0),
          agents: awaitingApproval?.data()?.count ?? 0,
          payments: pendingPayments?.data()?.count ?? 0,
        })
      } catch {
        // Soft-fail: badges are decorative; never block the shell.
      }
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])
  return badges
}

function NavBadge({ count }) {
  if (!count) return null
  return (
    <span
      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black"
      style={{ background: '#ff7a2e', color: '#fff' }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

function ViewAsMenu() {
  const [viewAs, setViewAs] = useState(() => {
    try { return localStorage.getItem(VIEW_AS_KEY) || '' } catch { return '' }
  })
  const [open, setOpen] = useState(false)

  const apply = useCallback((target) => {
    setOpen(false)
    if (target === 'teacher') {
      localStorage.setItem(VIEW_AS_KEY, 'teacher')
      setViewAs('teacher')
      window.location.href = '/teacher'
    } else if (target === 'learner') {
      localStorage.setItem(VIEW_AS_KEY, 'learner')
      setViewAs('learner')
      window.location.href = '/dashboard'
    } else {
      localStorage.removeItem(VIEW_AS_KEY)
      setViewAs('')
    }
  }, [])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="theme-bg-subtle theme-border hover:theme-accent-bg hover:theme-accent-text inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon as={Eye} size="xs" />
        View as
        <Icon as={ChevronDown} size="xs" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 z-50 w-44 theme-card border theme-border rounded-xl shadow-xl overflow-hidden">
          <button role="menuitem" onClick={() => apply('admin')} className="w-full text-left px-3 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
            Admin (default)
          </button>
          <button role="menuitem" onClick={() => apply('teacher')} className="w-full text-left px-3 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
            Teacher dashboard
          </button>
          <button role="menuitem" onClick={() => apply('learner')} className="w-full text-left px-3 py-2 text-sm font-bold theme-text hover:theme-bg-subtle">
            Learner dashboard
          </button>
        </div>
      )}
      {viewAs && (
        <span className="ml-2 text-[10px] font-black uppercase tracking-wider theme-text-muted">
          Previewing
        </span>
      )}
    </div>
  )
}

export default function AdminLayout({ children }) {
  const { logout, userProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const badges = useAdminBadges()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  // Cmd/Ctrl+K opens the global command palette so an admin can jump to
  // any section by name without reaching for the sidebar.
  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navClass = ({ isActive }) =>
    `relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all duration-fast ease-out ${
      isActive
        ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl pl-4'
        : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'
    }`
  const mobileNavClass = ({ isActive }) =>
    `relative flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-colors ${
      isActive ? 'theme-accent-bg theme-accent-text shadow-elev-inner-hl pl-5' : 'theme-text-muted hover:theme-bg-subtle hover:theme-text'
    }`
  const ActiveBar = () => (
    <span aria-hidden className="absolute left-1 top-2 bottom-2 w-1 rounded-full theme-accent-fill" />
  )

  const renderSection = (section, isMobile) => (
    <div key={section.label} className="mb-2">
      <p className="px-3 pt-3 pb-1 text-[10px] font-black uppercase tracking-[0.14em] theme-text-muted">
        {section.label}
      </p>
      {section.items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={isMobile ? () => setMobileOpen(false) : undefined}
          className={isMobile ? mobileNavClass : navClass}
        >
          {({ isActive }) => (
            <>
              {isActive && <ActiveBar />}
              <Icon as={item.icon} size="sm" />
              <span className="flex-1">{item.label}</span>
              <NavBadge count={item.badgeKey ? badges[item.badgeKey] : 0} />
            </>
          )}
        </NavLink>
      ))}
    </div>
  )

  return (
    <div className="studio-theme theme-bg theme-text min-h-screen flex">
      {/* ── Desktop Sidebar ─────────────────────────────── */}
      <aside
        className="theme-border shadow-elev-md hidden w-64 flex-shrink-0 flex-col border-r md:flex"
        style={{ backgroundColor: '#ffffff' }}
      >
        <div className="theme-border px-4 py-5 border-b" style={{ backgroundColor: '#fffaf0' }}>
          <Link to="/admin" className="inline-flex items-center gap-2.5 no-underline" style={{ color: '#0e2a32' }}>
            <Logo variant="icon" size="md" />
            <div className="leading-tight">
              <p className="studio-display" style={{ fontSize: 16, margin: 0, color: '#0e2a32' }}>
                ZedExams <span style={{ color: '#ff7a2e' }}>•</span>
              </p>
              <p style={{ fontSize: 11.5, color: '#566f76', margin: 0, fontWeight: 600 }}>Admin Panel</p>
            </div>
          </Link>
          <div className="mt-3 pl-1 flex items-center justify-between">
            <span className="studio-eyebrow">Control centre</span>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="theme-bg-subtle theme-border hover:theme-accent-bg hover:theme-accent-text inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-wider transition-colors"
              title="Quick search (⌘K)"
            >
              <Icon as={Search} size="xs" />
              ⌘K
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {NAV_SECTIONS.map(section => renderSection(section, false))}
          <div className="theme-border my-3 border-t" />
          <p className="px-3 pt-1 pb-1 text-[10px] font-black uppercase tracking-[0.14em] theme-text-muted">
            Quick switch
          </p>
          <Link
            to="/teacher"
            className="theme-text-muted hover:theme-bg-subtle hover:theme-text flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-all duration-fast ease-out"
          >
            <Icon as={GraduationCap} size="sm" />Teacher view
          </Link>
          <Link
            to="/dashboard"
            className="theme-text-muted hover:theme-bg-subtle hover:theme-text flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-all duration-fast ease-out"
          >
            <Icon as={Home} size="sm" />Learner view
          </Link>
        </nav>

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
            <Icon as={LogOut} size="sm" />Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile Header ───────────────────────────────── */}
      <div className="theme-border shadow-elev-md fixed left-0 right-0 top-0 z-40 border-b md:hidden" style={{ backgroundColor: '#ffffff' }}>
        <div className="flex items-center justify-between px-4 h-16">
          <Link to="/admin" className="flex items-center gap-2.5 no-underline" style={{ color: '#0e2a32' }}>
            <Logo variant="icon" size="md" />
            <div className="leading-tight">
              <p className="studio-display" style={{ fontSize: 15, margin: 0, color: '#0e2a32' }}>
                ZedExams <span style={{ color: '#ff7a2e' }}>•</span>
              </p>
              <p style={{ fontSize: 10.5, color: '#566f76', margin: 0, fontWeight: 600 }}>Admin Panel</p>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="theme-text-muted hover:theme-bg-subtle min-h-0 rounded-lg p-2 transition-colors"
              aria-label="Open command palette"
            >
              <Icon as={Search} size="md" />
            </button>
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
            className="theme-card theme-border absolute left-0 right-0 top-16 bottom-0 overflow-y-auto overscroll-contain border-t p-2 shadow-elev-xl"
            onClick={e => e.stopPropagation()}
          >
            {NAV_SECTIONS.map(section => renderSection(section, true))}
            <div className="theme-border my-2 border-t" />
            <Link
              to="/teacher"
              onClick={() => setMobileOpen(false)}
              className="theme-text-muted hover:theme-bg-subtle hover:theme-text flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-colors"
            >
              <Icon as={GraduationCap} size="sm" />Teacher view
            </Link>
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="theme-text-muted hover:theme-bg-subtle hover:theme-text flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold transition-colors"
            >
              <Icon as={Home} size="sm" />Learner view
            </Link>
            <button
              onClick={handleLogout}
              className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-danger hover:bg-danger-subtle min-h-0 transition-colors"
            >
              <Icon as={LogOut} size="sm" />Sign out
            </button>
          </nav>
        </div>
      )}

      {/* ── Main Content ────────────────────────────────── */}
      <main className="flex-1 min-w-0 md:pt-0 pt-16">
        {/* Top utility bar — theme picker + view-as toggle. Hidden on
            mobile because the mobile header already carries the brand. */}
        <div className="hidden md:flex items-center justify-end gap-3 px-6 py-3 theme-border border-b" style={{ background: 'rgba(255,255,255,0.6)' }}>
          <ViewAsMenu />
          <ThemeSelector />
        </div>
        <div className="app-container py-6 pb-28">
          <ErrorBoundary inline resetKey={location.pathname}>
            {children}
          </ErrorBoundary>
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sections={NAV_SECTIONS}
      />
    </div>
  )
}
