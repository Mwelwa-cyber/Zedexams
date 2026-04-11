import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useSubscription } from '../../hooks/useSubscription'
import Logo from '../ui/Logo'

export default function Navbar() {
  const { userProfile, logout, isAdmin, isTeacher } = useAuth()
  const { isPremium } = useSubscription()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const active = (path) => location.pathname === path
    ? 'text-yellow-300 font-black'
    : 'text-white/80 hover:text-white font-bold'

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  const links = [
    { to: '/dashboard', label: '🏠 Dashboard', show: true },
    { to: '/quizzes',   label: '📝 Quizzes',   show: true },
    { to: '/papers',    label: '📄 Papers',     show: true },
    { to: '/teacher',   label: '🎓 Teacher',    show: isTeacher && !isAdmin },
    { to: '/admin',     label: '⚙️ Admin',      show: isAdmin },
  ].filter(l => l.show)

  return (
    <nav className="bg-gradient-to-r from-green-700 to-green-900 shadow-lg sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/dashboard" className="flex items-center min-h-0">
          <Logo size="sm" variant="full" dark={false} />
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-5">
          {links.map(l => (
            <Link key={l.to} to={l.to} className={`text-sm transition-colors ${active(l.to)}`}>{l.label}</Link>
          ))}
        </div>

        {/* Right side */}
        <div className="hidden md:flex items-center gap-3">
          {isPremium && <span className="bg-yellow-400 text-yellow-900 font-black text-xs px-2 py-0.5 rounded-full">⭐ Premium</span>}
          <div className="text-right">
            <p className="text-white font-bold text-sm leading-tight">{userProfile?.displayName ?? 'User'}</p>
            <p className="text-white/60 text-xs capitalize">{userProfile?.role ?? 'learner'}</p>
          </div>
          <button onClick={handleLogout} className="bg-white/20 hover:bg-white/30 text-white font-bold text-xs px-3 py-1.5 rounded-full transition-colors min-h-0">
            Logout
          </button>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden text-white text-2xl min-h-0 p-1 bg-transparent shadow-none" onClick={() => setOpen(o => !o)}>
          {open ? '✕' : '☰'}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden bg-green-900 border-t border-white/10 px-4 py-3 space-y-2 animate-slide-up">
          {links.map(l => (
            <Link key={l.to} to={l.to} onClick={() => setOpen(false)}
              className={`block py-2 text-sm ${active(l.to)}`}>{l.label}</Link>
          ))}
          <hr className="border-white/20" />
          <div className="flex items-center justify-between py-1">
            <span className="text-white/80 text-sm">{userProfile?.displayName}</span>
            {isPremium && <span className="bg-yellow-400 text-yellow-900 font-black text-xs px-2 py-0.5 rounded-full">⭐</span>}
          </div>
          <button onClick={handleLogout} className="w-full text-left text-red-300 font-bold text-sm py-2 bg-transparent shadow-none min-h-0">
            🚪 Logout
          </button>
        </div>
      )}
    </nav>
  )
}
