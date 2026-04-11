import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import Logo from '../ui/Logo'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Home',        icon: '🏠' },
  { to: '/lessons',   label: 'Lessons',     icon: '📚' },
  { to: '/quizzes',   label: 'Quizzes',     icon: '✏️' },
  { to: '/papers',    label: 'Past Papers', icon: '📄' },
  { to: '/my-results', label: 'Results',   icon: '📊' },
]

export default function Navbar() {
  const { userProfile, logout, isAdmin, isTeacher } = useAuth()
  const { isPremium } = useSubscription()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const initials = (userProfile?.displayName || 'U')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <nav className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">

        {/* Logo */}
        <Link to="/dashboard" className="flex items-center min-h-0 flex-shrink-0">
          <Logo variant="full" size="md" />
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_LINKS.map(l => (
            <NavLink key={l.to} to={l.to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  isActive
                    ? 'bg-green-50 text-green-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`
              }>
              <span className="text-base">{l.icon}</span>
              <span>{l.label}</span>
            </NavLink>
          ))}
          {(isTeacher && !isAdmin) && (
            <NavLink to="/teacher"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  isActive ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-50'
                }`
              }>
              <span>🎓</span><span>Teacher</span>
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin"
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  isActive ? 'bg-green-50 text-green-700' : 'text-gray-600 hover:bg-gray-50'
                }`
              }>
              <span>⚙️</span><span>Admin</span>
            </NavLink>
          )}
        </div>

        {/* Right side — desktop */}
        <div className="hidden md:flex items-center gap-2 flex-shrink-0">
          {isPremium && (
            <span className="bg-yellow-100 text-yellow-700 font-black text-xs px-2.5 py-1 rounded-full border border-yellow-200">
              ⭐ Premium
            </span>
          )}
          <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
            <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white font-black text-xs flex-shrink-0">
              {initials}
            </div>
            <div className="text-right hidden lg:block">
              <p className="text-gray-800 font-black text-xs leading-tight truncate max-w-[100px]">
                {userProfile?.displayName ?? 'User'}
              </p>
              <p className="text-gray-400 text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
            </div>
            <button onClick={handleLogout}
              className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors min-h-0">
              Logout
            </button>
          </div>
        </div>

        {/* Mobile right — avatar + hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <div className="w-7 h-7 bg-green-600 rounded-full flex items-center justify-center text-white font-black text-xs flex-shrink-0">
            {initials}
          </div>
          <button onClick={() => setOpen(o => !o)}
            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-100 rounded-lg transition-colors min-h-0 bg-transparent shadow-none text-xl">
            {open ? '✕' : '☰'}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden border-t border-gray-100 bg-white shadow-lg animate-slide-up">
          <div className="max-w-5xl mx-auto px-4 py-3">
            {/* User info */}
            <div className="flex items-center gap-3 py-3 mb-2 border-b border-gray-100">
              <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center text-white font-black">
                {initials}
              </div>
              <div>
                <p className="font-black text-gray-800 text-sm">{userProfile?.displayName ?? 'User'}</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-gray-400 text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
                  {userProfile?.grade && <p className="text-gray-400 text-xs">· Grade {userProfile.grade}</p>}
                  {isPremium && <span className="text-yellow-600 text-xs font-black">⭐ Premium</span>}
                </div>
              </div>
            </div>

            {/* Nav links */}
            <div className="space-y-0.5">
              {NAV_LINKS.map(l => (
                <NavLink key={l.to} to={l.to} onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      isActive ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50'
                    }`
                  }>
                  <span className="text-base w-6 text-center">{l.icon}</span>
                  {l.label}
                </NavLink>
              ))}
              {(isTeacher && !isAdmin) && (
                <NavLink to="/teacher" onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      isActive ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50'
                    }`
                  }>
                  <span className="text-base w-6 text-center">🎓</span>Teacher
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/admin" onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      isActive ? 'bg-green-50 text-green-700' : 'text-gray-700 hover:bg-gray-50'
                    }`
                  }>
                  <span className="text-base w-6 text-center">⚙️</span>Admin Panel
                </NavLink>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-gray-100">
              <button onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 transition-colors min-h-0">
                <span className="text-base w-6 text-center">🚪</span>Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
