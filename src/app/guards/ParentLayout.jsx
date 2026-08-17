import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useNotifications } from '../../contexts/NotificationContext'
import Logo from '../../shared/components/Logo'
import Button from '../../shared/components/Button'
import Icon from '../../shared/components/Icon'
import { Bell, BellRing } from '../../shared/components/icons'

/**
 * ParentLayout — chrome for the family portal (/family*). Deliberately minimal:
 * a brand header with the parent's name, the notifications bell + a sign-out,
 * then the routed page. The parent surface is small (children list, per-child
 * progress, the inbox), so it does not need the learner Navbar or the teacher
 * sidebar.
 *
 * The bell LINKS to /family/notifications rather than opening the overlay
 * NotificationCenter the teacher and admin shells use. A parent's inbox is a
 * destination — the requests waiting in it are things they came to decide, not
 * a tray they glance at — which is also how the parent prototype draws it.
 */
export default function ParentLayout({ children }) {
  const { userProfile, logout } = useAuth()
  const { unreadCount } = useNotifications()
  const navigate = useNavigate()
  const firstName = userProfile?.displayName?.split(' ')[0] || 'Parent'
  const hasUnread = unreadCount > 0

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen theme-bg theme-text">
      <header className="sticky top-0 z-30 border-b theme-border theme-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/family" className="flex items-center gap-2" aria-label="Family home">
            <Logo className="h-7 w-auto" />
            <span className="hidden text-sm font-black theme-text sm:inline">Family</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden text-sm font-bold theme-text-muted sm:inline">
              {firstName}
            </span>
            <Link
              to="/family/notifications"
              aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              title="Notifications"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg theme-text-muted transition-colors hover:theme-text hover:theme-bg-subtle"
            >
              <Icon as={hasUnread ? BellRing : Bell} size="md" />
              {hasUnread && (
                <span
                  className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-black leading-none text-white"
                  aria-hidden="true"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">{children}</main>
    </div>
  )
}
