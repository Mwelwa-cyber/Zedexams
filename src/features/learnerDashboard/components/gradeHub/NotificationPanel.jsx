/**
 * The notifications drop-down. Stateless: GradeHub owns the list, the unread
 * count and what "seen" means (./seenNotifications).
 */
import { Link } from 'react-router-dom'
import { Sparkles } from '../../../../shared/components/icons'
import Icon from '../../../../shared/components/Icon'

function NotificationPanel({ notifications, unreadCount, onClose }) {
  return (
    <div className="zx-card fixed right-3 top-20 z-50 w-[min(92vw,22rem)] theme-card rounded-2xl border theme-border p-3 shadow-xl animate-scale-in">
      <div className="flex items-center justify-between gap-3 border-b theme-border px-1 pb-2">
        <div>
          <p className="theme-text text-sm font-black">Notifications</p>
          <p className="theme-text-muted text-xs font-bold">
            {notifications.length === 0
              ? 'You are all caught up'
              : unreadCount > 0
                ? `${unreadCount} new update${unreadCount === 1 ? '' : 's'}`
                : 'You are all caught up'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="theme-text-muted min-h-0 bg-transparent px-2 py-1 text-xs font-black shadow-none hover:theme-text"
        >
          Close
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="px-1 py-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-2xl border theme-border theme-bg-subtle theme-accent-text">
            <Icon as={Sparkles} size="lg" strokeWidth={2.1} />
          </div>
          <p className="theme-text mt-2 text-sm font-black">No new notifications</p>
          <p className="theme-text-muted mt-1 text-xs">Keep learning and your next update will appear here.</p>
        </div>
      ) : (
        <div className="max-h-80 space-y-2 overflow-y-auto pt-3">
          {notifications.map(note => (
            <Link
              key={note.id}
              to={note.to}
              onClick={onClose}
              className="theme-bg-subtle block rounded-2xl border theme-border px-3 py-3 transition-colors hover:theme-card-hover"
            >
              <div className="flex items-start gap-3">
                <div className="theme-card theme-accent-text flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border theme-border">
                  <Icon as={note.icon} size="md" strokeWidth={2.1} />
                </div>
                <div className="min-w-0">
                  <p className="theme-text text-sm font-black leading-snug">{note.title}</p>
                  <p className="theme-text-muted mt-1 text-xs font-bold leading-relaxed">{note.body}</p>
                  <p className="theme-accent-text mt-1 text-xs font-black">{note.cta}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default NotificationPanel
