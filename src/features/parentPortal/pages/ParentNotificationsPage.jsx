// src/features/parentPortal/pages/ParentNotificationsPage.jsx
//
// /family/notifications — the parent prototype's Notifications screen: the
// Today / Earlier heads, "Mark all read", and the cards a guardian taps to
// get to the thing the notification is about.
//
// Three things worth knowing before changing it:
//
//   1. It adds NO storage. A parent has a uid, so their notifications are the
//      ordinary `notifications/{uid}/feed` docs written server-side by
//      `createNotification` and streamed by the one app-wide listener in
//      NotificationProvider. This screen is a view; read-state changes go
//      back through the context's markRead / markAllRead, which is the only
//      thing a client is allowed to write on a notification.
//
//   2. Every decision on it is somewhere else and tested under plain node —
//      lib/parentNotificationView.js. What is left here is rendering, which
//      is what the Vitest spec beside this file covers.
//
//   3. It renders inside ParentShell like every other parent screen. It was
//      SELF-CHROMED when it shipped — mounted outside the old Tailwind
//      ParentLayout with its own `.lhx` wrapper — because it was "the parent
//      side's first in that reskin" and mixing the two inside one shell would
//      have read as a bug in both. The rest of the reskin has since landed,
//      so the wrapper came off and the shell supplies it: the tab bar belongs
//      here, since a parent arrives from the bell and leaves to whatever the
//      notification was about. Its own back row stays.
//
// The footer line is not decoration: the prototype ends this list by saying
// where the switches are, because an inbox a parent cannot tune is one they
// eventually stop opening.

import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useNotifications } from '../../../contexts/NotificationContext'
import { ageLabel, groupForInbox, inAppPath, tileFor } from '../lib/parentNotificationView'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'

function NotificationCard({ notification, onOpen }) {
  const tile = tileFor(notification)
  return (
    <button
      type="button"
      className={`lhx-notif-item ${notification.read ? '' : 'is-unread'}`}
      onClick={() => onOpen(notification)}
    >
      <span className={`lhx-notif-ic ${tile.cls}`} aria-hidden="true">{tile.emoji}</span>
      <span className="lhx-notif-body">
        <span className="lhx-notif-title" style={{ display: 'block' }}>{notification.title}</span>
        {notification.body && (
          <span className="lhx-notif-text" style={{ display: 'block' }}>{notification.body}</span>
        )}
        <span className="lhx-notif-time" style={{ display: 'block' }}>
          {ageLabel(notification.createdAt)}
        </span>
      </span>
    </button>
  )
}

function Section({ label, rows, showMarkAll, onMarkAll, onOpen }) {
  return (
    <section aria-label={label} style={{ marginTop: 18 }}>
      <div className="lhx-notif-head-row">
        <div style={{ fontSize: '12.5px', color: 'var(--lhx-muted)', fontWeight: 800 }}>{label}</div>
        {showMarkAll && (
          <button type="button" className="lhx-notif-mark" onClick={onMarkAll}>Mark all read</button>
        )}
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {rows.map((n) => (
          <NotificationCard key={n.id} notification={n} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

export default function ParentNotificationsPage() {
  const navigate = useNavigate()
  const {
    notifications, unreadCount, loading, hasMore, loadMore, markRead, markAllRead,
  } = useNotifications()

  const { today, earlier } = useMemo(() => groupForInbox(notifications), [notifications])

  function openNotification(n) {
    if (!n.read) markRead(n.id)
    const path = inAppPath(n)
    if (path) navigate(path)
  }

  const empty = !loading && (notifications || []).length === 0

  return (
    <>
        <SeoHelmet title="Notifications" path="/family/notifications" noIndex />

        <div className="lhx-back-row">
          <button
            type="button"
            className="lhx-back-btn"
            aria-label="Back to your family home"
            onClick={() => navigate('/family')}
          >
            ‹
          </button>
          <h1 className="lhx-back-title">Notifications</h1>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={76} className="lhx-skel" style={{ borderRadius: 24 }} />
            ))}
          </div>
        ) : empty ? (
          <div className="lhx-card" style={{ padding: 24, marginTop: 18, textAlign: 'center' }}>
            <div style={{ fontSize: 34, marginBottom: 6 }} aria-hidden="true">🔔</div>
            <p className="lhx-back-title" style={{ fontSize: 16 }}>You&rsquo;re all caught up</p>
            <p className="lhx-notif-text">
              Requests from your children, weekly reports and billing notices land here.
            </p>
          </div>
        ) : (
          <>
            {today.length > 0 && (
              <Section
                label="Today"
                rows={today}
                showMarkAll={unreadCount > 0}
                onMarkAll={markAllRead}
                onOpen={openNotification}
              />
            )}

            {earlier.length > 0 && (
              <Section
                label="Earlier"
                rows={earlier}
                showMarkAll={today.length === 0 && unreadCount > 0}
                onMarkAll={markAllRead}
                onOpen={openNotification}
              />
            )}

            {hasMore && (
              <button
                type="button"
                className="lhx-btn lhx-btn-block"
                style={{
                  marginTop: 14,
                  background: 'var(--lhx-card)',
                  color: 'var(--lhx-indigo-text)',
                  boxShadow: 'var(--lhx-shadow)',
                }}
                onClick={loadMore}
              >
                Show earlier notifications
              </button>
            )}
          </>
        )}

        <p
          className="lhx-notif-text"
          style={{ textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}
        >
          Choose which of these you get in{' '}
          {/* The parent's OWN alert settings, not /settings. ParentRouteGuard
              already redirects a guardian off the learner settings screen, so
              this was no longer a leak — but it was still a link that named
              the wrong destination and described it with the wrong words
              ("Settings → Notifications" is the learner's screen). A footer
              whose job is to say where the switches are should say where they
              actually are. */}
          <Link
            to="/family/account/alerts"
            style={{ color: 'var(--lhx-indigo-text)', fontWeight: 800 }}
          >
            Account → Alerts
          </Link>
          .
        </p>
    </>
  )
}
