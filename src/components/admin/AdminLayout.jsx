import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import Logo from '../ui/Logo'

const NAV = [
  { to: '/admin',          icon: '📊', label: 'Dashboard',      end: true },
  { to: '/admin/lessons/new', icon: '📖', label: 'Create Lesson' },
  { to: '/admin/quizzes/new', icon: '✏️', label: 'Create Quiz'   },
  { to: '/admin/content',  icon: '📁', label: 'Manage Content'  },
  { to: '/admin/results',  icon: '📈', label: 'Results'         },
]

export default function AdminLayout({ children }) {
  const { logout, userProfile } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

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
          <Logo variant="full" size="md" />
          <p className="text-xs font-bold text-green-600 mt-1.5 pl-1">Admin Panel</p>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  isActive ? 'bg-green-50 text-green-700 shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
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
            <div className="w-7 h-7 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-black text-xs flex-shrink-0">
              {(userProfile?.displayName || 'A')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-gray-800 truncate">{userProfile?.displayName || 'Admin'}</p>
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
        <div className="flex items-center justify-between px-4 h-16">
          <div className="flex items-center gap-2.5">
            <Logo variant="icon" size="md" />
            <span className="font-black text-gray-800 text-sm">Admin Panel</span>
          </div>
          <button onClick={() => setMobileOpen(o => !o)}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 min-h-0">
            {mobileOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* ── Mobile Drawer Overlay ────────────────────────── */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-30" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <nav className="absolute top-14 left-0 right-0 bg-white shadow-xl border-t border-gray-100 p-3 space-y-1"
            onClick={e => e.stopPropagation()}>
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to} end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                    isActive ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-50'
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
      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        <div className="max-w-4xl mx-auto px-4 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
