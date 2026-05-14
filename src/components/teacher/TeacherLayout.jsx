import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  PencilLine,
  BookOpen,
  FolderOpen,
  GraduationCap,
  LogOut,
  Settings,
  Bot,
  Users,
} from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import Icon from '../ui/Icon'
import TeacherTopBar from './TeacherTopBar'
import TeacherGlassHeader from './TeacherGlassHeader'
import TeacherBottomNav from './TeacherBottomNav'

const NAV = [
  { to: '/teacher',                  icon: LayoutDashboard, label: 'My Dashboard', end: true },
  { to: '/teacher/library',          icon: FolderOpen,      label: 'Library'                 },
  { to: '/teacher/assessments',      icon: PencilLine,      label: 'Assessments'             },
  { to: '/teacher/lessons/new',      icon: BookOpen,        label: 'Create Lesson'           },
  { to: '/teacher/curriculum',       icon: GraduationCap,   label: 'Curriculum'              },
  { to: '/teacher/classes',          icon: Users,           label: 'Classes'                 },
  { to: '/teacher/agents',           icon: Bot,             label: 'Agent Submissions'       },
  { to: '/settings',                 icon: Settings,        label: 'Settings'                },
]

export default function TeacherLayout({ children }) {
  const { logout, userProfile, isAdmin } = useAuth()
  const navigate = useNavigate()

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
  const ActiveBar = () => (
    <span
      aria-hidden
      className="absolute left-1 top-2 bottom-2 w-1 rounded-full theme-accent-fill"
    />
  )

  return (
    <div className="studio-theme theme-bg theme-text min-h-screen flex">
      {/* ── Desktop Sidebar (lg+) ─────────────────────────── */}
      <aside
        className="theme-border shadow-elev-md hidden w-60 flex-shrink-0 flex-col border-r lg:flex"
        style={{ backgroundColor: '#ffffff' }}
      >
        <div
          className="theme-border px-4 py-5 border-b"
          style={{ backgroundColor: '#fffaf0' }}
        >
          <Link to="/teacher" className="inline-flex items-center gap-2.5 no-underline" style={{ color: '#0e2a32' }}>
            <Logo variant="icon" size="md" />
            <div className="leading-tight">
              <p className="studio-display" style={{ fontSize: 16, margin: 0, color: '#0e2a32' }}>
                ZedExams <span style={{ color: '#ff7a2e' }}>•</span>
              </p>
              <p style={{ fontSize: 11.5, color: '#566f76', margin: 0, fontWeight: 600 }}>
                Lesson Plan Studio
              </p>
            </div>
          </Link>
          <div className="mt-3 pl-1">
            <span className="studio-eyebrow">Teacher Panel</span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {isAdmin && (
            <>
              <Link
                to="/admin"
                className="theme-bg-subtle theme-text hover:theme-accent-bg hover:theme-accent-text flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold transition-all duration-fast ease-out"
              >
                <Icon as={Settings} size="sm" />
                Admin Panel
              </Link>
              <div className="theme-border my-2 border-t" />
            </>
          )}
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              {({ isActive }) => (
                <>
                  {isActive && <ActiveBar />}
                  <Icon as={item.icon} size="sm" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span
                      className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: '#ff7a2e', color: '#fff', letterSpacing: '0.08em' }}
                    >
                      {item.badge}
                    </span>
                  )}
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

      {/* ── Glass header (mobile + tablet) ─────────────────── */}
      <TeacherGlassHeader />

      {/* ── Main Content ────────────────────────────────── */}
      <main className="flex-1 min-w-0 pt-16 lg:pt-0">
        <div className="app-container py-6 pb-24 lg:pb-6">
          <TeacherTopBar />
          {children}
        </div>
      </main>

      {/* ── Bottom shortcut nav (mobile + tablet) ──────────── */}
      <TeacherBottomNav />
    </div>
  )
}
