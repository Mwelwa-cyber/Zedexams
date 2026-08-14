import { useNotifications } from '../../../contexts/NotificationContext'
import { Bell, BellRing } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'
import NotificationCenter from './NotificationCenter'

/**
 * Bell icon + unread badge for the top navigation. Opens the Notification
 * Center. Shared across learner / teacher / admin shells — the notifications
 * themselves are role-agnostic.
 *
 * `withPanel` — the Notification Center portals to <body>, so when a shell
 * mounts two bells (Navbar has a desktop and a mobile cluster; only one is
 * visible at a time) exactly ONE of them may own the panel, or two identical
 * overlays stack. Pass `withPanel={false}` on every bell after the first.
 */
export default function NotificationBell({ withPanel = true }) {
  const { unreadCount, open, setOpen } = useNotifications()
  const hasUnread = unreadCount > 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        title="Notifications"
        aria-haspopup="dialog"
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg theme-text-muted hover:theme-text hover:theme-bg-subtle transition-colors min-h-0 bg-transparent shadow-none"
      >
        <Icon as={hasUnread ? BellRing : Bell} size="md" />
        {hasUnread && (
          <span
            className="absolute -top-0.5 -right-0.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-black leading-none text-white"
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {withPanel && open && <NotificationCenter />}
    </>
  )
}
