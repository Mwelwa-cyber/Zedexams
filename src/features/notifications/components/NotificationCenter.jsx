import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../../contexts/NotificationContext'
import { confirmShellNavigation } from '../../../shared/utils/shellNavGuardCore'
import Icon from '../../../shared/components/Icon'
import { Bell, Check, Search, Settings, Trash2, X } from '../../../shared/components/icons'
import {
  NOTIFICATION_CATEGORIES,
  categoryLabel,
  relativeTime,
  resolveNotificationIcon,
} from '../lib/notificationIcons'

const PRIORITY_DOT = {
  high: 'bg-danger',
  medium: 'theme-accent-fill',
  low: 'theme-text-muted',
}

/** One notification row, with swipe-to-delete on touch devices. */
function NotificationRow({ n, onOpen, onDelete }) {
  const [dx, setDx] = useState(0)
  const startX = useRef(null)
  const NotifIcon = resolveNotificationIcon(n.icon)

  const onTouchStart = (e) => {
    startX.current = e.touches[0].clientX
  }
  const onTouchMove = (e) => {
    if (startX.current == null) return
    const delta = e.touches[0].clientX - startX.current
    if (delta < 0) setDx(Math.max(delta, -120))
  }
  const onTouchEnd = () => {
    if (dx < -80) onDelete(n.id)
    setDx(0)
    startX.current = null
  }

  return (
    <div className="relative overflow-hidden">
      {/* Reveal-on-swipe delete affordance */}
      <div className="absolute inset-y-0 right-0 flex items-center bg-danger px-5 text-white">
        <Icon as={Trash2} size="sm" />
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(n)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onOpen(n)
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${dx}px)` }}
        className={`relative flex w-full cursor-pointer items-start gap-3 border-b theme-border px-4 py-3 text-left transition-transform ${
          n.read ? 'theme-card' : 'theme-accent-bg'
        }`}
      >
        {/* Unread dot */}
        <span
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'theme-accent-fill'}`}
          aria-hidden="true"
        />
        <span className="mt-0.5 shrink-0 theme-text-muted">
          <Icon as={NotifIcon} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`min-w-0 flex-1 truncate text-body-sm ${n.read ? 'theme-text' : 'theme-text font-black'}`}>
              {n.title}
            </p>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[n.priority] || PRIORITY_DOT.low}`}
              aria-label={`${n.priority || 'low'} priority`}
            />
          </div>
          {n.body && <p className="mt-0.5 line-clamp-2 text-xs theme-text-muted">{n.body}</p>}
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[11px] theme-text-muted">{relativeTime(n.createdAt)}</span>
            <span className="text-[11px] theme-text-muted">· {categoryLabel(n.category)}</span>
            {n.action?.label && (
              <span className="text-[11px] font-bold theme-accent-text">{n.action.label} →</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(n.id)
          }}
          aria-label="Delete notification"
          className="-m-1 hidden shrink-0 rounded-lg p-1 theme-text-muted transition-colors hover:text-danger sm:block"
        >
          <Icon as={X} size="xs" />
        </button>
      </div>
    </div>
  )
}

export default function NotificationCenter() {
  const navigate = useNavigate()
  const {
    notifications,
    loading,
    hasMore,
    setOpen,
    loadMore,
    markRead,
    markAllRead,
    remove,
    removeAll,
  } = useNotifications()

  const [category, setCategory] = useState('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [search, setSearch] = useState('')
  const panelRef = useRef(null)

  // Close on Escape and move focus into the panel when it opens (a11y).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notifications.filter((n) => {
      if (category !== 'all' && n.category !== category) return false
      if (unreadOnly && n.read) return false
      if (q) {
        const hay = `${n.title || ''} ${n.body || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [notifications, category, unreadOnly, search])

  const close = () => setOpen(false)

  const openNotification = (n) => {
    const url = n.action?.url
    const external = url && /^https?:\/\//i.test(url)
    // An in-app SPA navigation unmounts the current page — gate it behind any
    // registered unsaved-changes guard (e.g. dirty register marks) so a
    // notification tap can't silently discard them. External links open a new
    // tab and leave the page mounted, so they're never gated.
    if (url && !external && !confirmShellNavigation()) return
    if (!n.read) markRead(n.id)
    if (url) {
      close()
      if (external) window.open(url, '_blank', 'noopener')
      else navigate(url)
    }
  }

  const goToSettings = () => {
    if (!confirmShellNavigation()) return
    close()
    navigate('/settings')
  }

  // Portal to <body>: the bell that opens this lives inside the glass navbar,
  // whose backdrop-filter + will-change:transform (.zx-glass-nav /
  // .zx-nav-autohide) make the nav the containing block for fixed-position
  // descendants — rendered in place, this "full-screen" overlay would be
  // squashed into the 80px nav strip and look like the bell does nothing.
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex justify-end sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" onMouseDown={close} />

      {/* Panel: full-screen on mobile, anchored card on desktop */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-hidden theme-card shadow-elev-xl animate-slide-up outline-none sm:h-auto sm:max-h-[80vh] sm:w-[26rem] sm:rounded-2xl sm:border theme-border"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b theme-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon as={Bell} size="sm" className="theme-text" />
            <h2 className="text-base font-black theme-text">Notifications</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToSettings}
              aria-label="Notification settings"
              className="rounded-lg p-1.5 theme-text-muted transition-colors hover:theme-text hover:theme-bg-subtle"
            >
              <Icon as={Settings} size="sm" />
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Close notifications"
              className="rounded-lg p-1.5 theme-text-muted transition-colors hover:theme-text hover:theme-bg-subtle"
            >
              <Icon as={X} size="sm" />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-2 border-b theme-border px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-muted">
                <Icon as={Search} size="xs" />
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search notifications"
                aria-label="Search notifications"
                className="w-full rounded-lg border theme-border theme-bg py-1.5 pl-8 pr-2 text-xs theme-text placeholder:theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs theme-text-muted">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Unread
            </label>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {['all', ...NOTIFICATION_CATEGORIES].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  category === c ? 'theme-accent-fill text-[var(--accent-text)]' : 'theme-bg-subtle theme-text-muted'
                }`}
              >
                {c === 'all' ? 'All' : categoryLabel(c)}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 text-[11px] font-bold theme-accent-text hover:underline"
            >
              <Icon as={Check} size="xs" /> Mark all read
            </button>
            <button
              type="button"
              onClick={removeAll}
              className="inline-flex items-center gap-1 text-[11px] font-bold theme-text-muted hover:text-danger"
            >
              <Icon as={Trash2} size="xs" /> Clear all
            </button>
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading && notifications.length === 0 ? (
            <div className="px-4 py-10 text-center text-body-sm theme-text-muted">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full theme-bg-subtle theme-text-muted">
                <Icon as={Bell} size="lg" />
              </span>
              <p className="text-body-sm font-bold theme-text">
                {notifications.length === 0 ? 'No notifications yet' : 'Nothing matches your filters'}
              </p>
              <p className="max-w-[16rem] text-xs theme-text-muted">
                {notifications.length === 0
                  ? "You're all caught up. New updates about your learning, lessons and account will show here."
                  : 'Try a different category or clear the search.'}
              </p>
            </div>
          ) : (
            <>
              {filtered.map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={openNotification} onDelete={remove} />
              ))}
              {hasMore && !search && category === 'all' && !unreadOnly && (
                <button
                  type="button"
                  onClick={loadMore}
                  className="w-full py-3 text-center text-xs font-bold theme-accent-text hover:theme-bg-subtle"
                >
                  Load older notifications
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
