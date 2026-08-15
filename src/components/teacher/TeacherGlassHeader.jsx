import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import useClickAway from '../../hooks/useClickAway'
import useTeacherReminders from '../../hooks/useTeacherReminders'
import ReminderPanel from '../../shared/components/ReminderPanel'
import Logo from '../../shared/components/Logo'
import Icon from '../../shared/components/Icon'
import useHideOnScroll from '../../hooks/useHideOnScroll'
import { HeaderIconLink, HeaderIconButton } from '../../shared/components/HeaderIconButton'
import {
  BarChart3,
  Bell,
  User,
  Settings,
  LogOut,
} from '../../shared/components/icons'

export default function TeacherGlassHeader() {
  const { currentUser, userProfile, isAdmin, logout } = useAuth()
  const navigate = useNavigate()

  const [bellOpen, setBellOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)

  const bellRef = useRef(null)
  const accountRef = useRef(null)

  useClickAway(bellRef, () => setBellOpen(false))
  useClickAway(accountRef, () => setAccountOpen(false))

  const { reminders, unreadCount } = useTeacherReminders(currentUser, { open: bellOpen })

  // LinkedIn-style auto-hide, but keep the header pinned while a dropdown is
  // open so its menu stays anchored and reachable.
  const scrolledHidden = useHideOnScroll()
  const headerHidden = scrolledHidden && !bellOpen && !accountOpen

  async function handleSignOut() {
    setAccountOpen(false)
    await logout()
    navigate('/login')
  }

  return (
    <header className={`zx-glass-nav safe-top fixed inset-x-0 top-0 z-40 lg:hidden zx-nav-autohide ${headerHidden ? 'zx-nav-hidden-top' : ''}`}>
      <div className="app-container flex min-h-16 items-start justify-between gap-2 px-3 pt-1 pb-2 sm:px-4">
        <Link to="/teacher" className="zx-logo-pill self-center no-underline" aria-label="Teacher home">
          <Logo variant="full" size="sm" className="h-10" />
        </Link>

        <div className="flex items-start gap-1 sm:gap-1.5">
          <HeaderIconLink to="/teacher/register" label="Progress" icon={BarChart3} size="sm" />

          <div ref={bellRef} className="relative">
            <HeaderIconButton
              label="Alerts"
              icon={Bell}
              size="sm"
              onClick={() => { setBellOpen(o => !o); setAccountOpen(false) }}
              aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : 'Alerts'}
              aria-expanded={bellOpen}
              aria-haspopup="true"
              important={unreadCount > 0}
              active={bellOpen}
              badge={unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : null}
            >
              {bellOpen && (
                <ReminderPanel
                  reminders={reminders}
                  onNavigate={() => setBellOpen(false)}
                  className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-1rem)]"
                />
              )}
            </HeaderIconButton>
          </div>

          <div ref={accountRef} className="relative">
            <HeaderIconButton
              label="Account"
              icon={User}
              size="sm"
              onClick={() => { setAccountOpen(o => !o); setBellOpen(false) }}
              aria-label={`Account menu for ${userProfile?.displayName || 'your account'}`}
              aria-expanded={accountOpen}
              aria-haspopup="true"
              active={accountOpen}
            >
              {accountOpen && (
                <div className="theme-card theme-border absolute right-0 top-12 z-50 min-w-[200px] rounded-2xl border py-2 shadow-xl">
                  <p className="theme-border theme-text border-b px-4 py-2 text-xs font-black">
                    {userProfile?.displayName || 'Teacher'}
                  </p>
                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setAccountOpen(false)}
                      className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                    >
                      <Icon as={Settings} size="sm" strokeWidth={2.1} /> Admin Panel
                    </Link>
                  )}
                  <Link
                    to="/profile"
                    onClick={() => setAccountOpen(false)}
                    className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                  >
                    <Icon as={User} size="sm" strokeWidth={2.1} /> My Profile
                  </Link>
                  <Link
                    to="/settings"
                    onClick={() => setAccountOpen(false)}
                    className="theme-text hover:theme-bg-subtle flex items-center gap-2 px-4 py-2 text-sm font-bold no-underline"
                  >
                    <Icon as={Settings} size="sm" strokeWidth={2.1} /> Settings
                  </Link>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="flex w-full items-center gap-2 rounded-none bg-transparent px-4 py-2 text-left text-sm font-bold text-red-500 shadow-none hover:bg-red-50 min-h-0"
                  >
                    <Icon as={LogOut} size="sm" strokeWidth={2.1} /> Sign Out
                  </button>
                </div>
              )}
            </HeaderIconButton>
          </div>
        </div>
      </div>
    </header>
  )
}
