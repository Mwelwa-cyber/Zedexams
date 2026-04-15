import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'

const NAV = [
  { to: '/teacher',               icon: '📊', label: 'My Dashboard', end: true },
  { to: '/teacher/content',       icon: '📁', label: 'My Content'              },
  { to: '/teacher/lessons',       icon: '▦', label: 'My Lessons'              },
  { to: '/teacher/quizzes/new',   icon: '✏️', label: 'Create Quiz'             },
  { to: '/teacher/lessons/new',   icon: '📖', label: 'Create Lesson'           },
  { to: '/teacher/papers/upload', icon: '📤', label: 'Upload Paper'            },
]

export default function TeacherLayout({ children }) {
  const { logout, userProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isLessonWorkspace = location.pathname.startsWith('/teacher/lessons')

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* ── Desktop Sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-60 bg-white border-r border-gray-100 shadow-sm flex-shrink-0">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gray-100">
          <Link to="/teacher" className="inline-flex">
            <Logo variant="full" size="md" />
          </Link>
          <p className="text-xs font-bold text-blue-600 mt-1.5 pl-1">Teacher Panel</p>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-3 space-y-1">
          <Link
            to="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-700 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 transition-colors"
          >
            <span className="text-base">🏠</span>
            Learner Dashboard
          </Link>
          <div className="my-2 border-t border-gray-100" />
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  isActive ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`
              }>
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User info + Logout */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex items-center gap-2 px-3 py-2 mb-1">
            <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-black text-xs flex-shrink-0">
              {(userProfile?.displayName || 'T')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-gray-800 truncate">{userProfile?.displayName || 'Teacher'}</p>
              <p className="text-xs text-gray-400 truncate">{userProfile?.email}</p>
            </div>
          </div>
          <button onClick={handleLogout}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-colors min-h-0">
            🚪 Sign Out
          </button>
        </div>
      </aside>

      {/* ── Mobile Header ───────────────────────────────── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-100 shadow-sm">
        <div className="flex items-center justify-between px-4 h-20">
          <Link to="/teacher" className="flex items-center gap-2.5">
            <Logo variant="icon" size="md" />
            <span className="font-black text-gray-800 text-sm">Teacher Panel</span>
          </Link>
          <button onClick={() => setMobileOpen(o => !o)}
            aria-label={mobileOpen ? 'Close teacher navigation' : 'Open teacher navigation'}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 min-h-0">
            {mobileOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* ── Mobile Drawer Overlay ────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <nav className="absolute top-20 left-0 right-0 bg-white shadow-xl border-t border-gray-100 p-3 space-y-1"
            onClick={e => e.stopPropagation()}>
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-gray-700 bg-gray-50 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              <span>🏠</span>Learner Dashboard
            </Link>
            <div className="my-2 border-t border-gray-100" />
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                  }`
                }>
                <span>{item.icon}</span>{item.label}
              </NavLink>
            ))}
            <button onClick={handleLogout}
              className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 min-h-0">
              🚪 Sign Out
            </button>
          </nav>
        </div>
      )}

      {/* ── Main Content ────────────────────────────────── */}
      <main className="flex-1 min-w-0 md:pt-0 pt-20">
        <div className={`${isLessonWorkspace ? 'max-w-7xl' : 'max-w-4xl'} mx-auto px-4 py-6`}>
          {children}
        </div>
      </main>
    </div>
  )
}
