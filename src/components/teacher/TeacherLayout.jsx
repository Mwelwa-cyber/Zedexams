import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  PencilLine,
  FolderOpen,
  GraduationCap,
  CalendarDays,
  LogOut,
  Settings,
  FileText,
  BookOpen,
  Target,
  ClipboardList,
} from '../ui/icons'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'
import Icon from '../ui/Icon'
import TeacherTopBar from './TeacherTopBar'
import ErrorBoundary from '../ui/ErrorBoundary'
import TeacherGlassHeader from './TeacherGlassHeader'
import TeacherBottomNav from './TeacherBottomNav'

const NAV = [
  { to: '/teacher',                        icon: LayoutDashboard, label: 'My Dashboard', end: true },
  { to: '/teacher/generate/lesson-plan',   icon: FileText,        label: 'Lesson Plans'            },
  { to: '/teacher/generate/scheme-of-work', icon: BookOpen,       label: 'Schemes of Work'         },
  { to: '/teacher/generate/weekly-forecast', icon: Target,        label: 'Weekly Focus'            },
  { to: '/teacher/generate/record-of-work', icon: ClipboardList,  label: 'Record of Work'          },
  { to: '/teacher/library',                icon: FolderOpen,      label: 'My Library'              },
  { to: '/teacher/test-papers',            icon: PencilLine,      label: 'Test Papers'             },
  { to: '/teacher/syllabi',                icon: FolderOpen,      label: 'Syllabi Studio'          },
  { to: '/teacher/curriculum',             icon: GraduationCap,   label: 'Curriculum'              },
  { to: '/teacher/calendar',               icon: CalendarDays,    label: 'School Calendar'         },
  { to: '/settings',                       icon: Settings,        label: 'Settings'                },
]

export default function TeacherLayout({ children }) {
  const { logout, userProfile, isAdmin } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

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
        className="theme-border shadow-elev-md hidden w-60 flex-shrink-0 flex-col border-r lg:flex lg:sticky lg:top-0 lg:h-screen lg:self-start"
        style={{ backgroundColor: '#ffffff' }}
      >
        <div
          className="theme-border px-4 py-5 border-b"
          style={{ backgroundColor: '#fffaf0' }}
        >
          <Link to="/teacher" className="inline-flex items-center gap-2.5 no-underline" style={{ color: '#0e2a32' }}>
            <Logo variant="icon" size="md" />
            <div className="leading-tight">
              <p className="studio-display" style={{ fontSize: 16, margin: 0 }}>
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

        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
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

      {/* ── Bottom shortcut nav (mobile + tablet) ──────────── */}
      <TeacherBottomNav />
    </div>
  )
}
