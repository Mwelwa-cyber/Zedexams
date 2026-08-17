// src/features/notifications/pages/LearnerNotificationsPage.jsx
//
// /notifications — the prototype-v6 learner notification centre (learner
// redesign step 10), a full-screen view inside the learner shell (the
// mockup keeps the four-tab nav visible). The topbar bell lands here.
//
// It is a THIN VIEW over the existing notification system: the docs live
// in notifications/{uid}/feed (server-written only), the one app-wide
// listener lives in NotificationProvider, and read-state mutations go
// through the context's markRead; "Clear all" goes through removeAll.
// The overlay
// NotificationCenter remains for the teacher/admin shells.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useNotifications } from '../../../contexts/NotificationContext'
import { relativeTime } from '../lib/notificationIcons'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import Skeleton from '../../../shared/components/Skeleton'

// Per-category tile: emoji + the mockup's soft radial gradients.
const CATEGORY_TILE = {
  learning: { emoji: '🧠', cls: 'lhx-ni-quiz' },
  lessonPlans: { emoji: '📘', cls: 'lhx-ni-duel' },
  assessments: { emoji: '📅', cls: 'lhx-ni-exam' },
  payments: { emoji: '💳', cls: 'lhx-ni-ok' },
  account: { emoji: '✅', cls: 'lhx-ni-ok' },
  system: { emoji: '⚙️', cls: 'lhx-ni-streak' },
  announcements: { emoji: '📣', cls: 'lhx-ni-badge' },
}
const tileFor = (category) => CATEGORY_TILE[category] || { emoji: '🔔', cls: 'lhx-ni-quiz' }

function startOfToday(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

function NotifCard({ n, onOpen }) {
  const tile = tileFor(n.category)
  return (
    <button type="button" className={`lhx-notif-item ${n.read ? '' : 'is-unread'}`} onClick={() => onOpen(n)}>
      <span className={`lhx-notif-ic ${tile.cls}`} aria-hidden="true">{tile.emoji}</span>
      <span className="lhx-notif-body">
        <span className="lhx-notif-title" style={{ display: 'block' }}>{n.title}</span>
        {n.body && <span className="lhx-notif-text" style={{ display: 'block' }}>{n.body}</span>}
        <span className="lhx-notif-time" style={{ display: 'block' }}>{relativeTime(n.createdAt)}</span>
      </span>
    </button>
  )
}

export default function LearnerNotificationsPage() {
  const navigate = useNavigate()
  const {
    notifications, loading, hasMore, loadMore, markRead, removeAll,
  } = useNotifications()

  // "Clear all" DELETES the feed, and there is no undo. The prototype
  // fires it on one tap — it can afford to, because its own "Show demo
  // notifications" button puts everything back. The real app has no such
  // button, so the control asks once. It is still a single control in the
  // same place, not a modal: one deliberate beat, then it does exactly
  // what the mockup does.
  const [confirming, setConfirming] = useState(false)
  const confirmTimer = useRef(null)
  useEffect(() => () => clearTimeout(confirmTimer.current), [])

  const clearAll = () => {
    if (!confirming) {
      setConfirming(true)
      clearTimeout(confirmTimer.current)
      confirmTimer.current = setTimeout(() => setConfirming(false), 4000)
      return
    }
    clearTimeout(confirmTimer.current)
    setConfirming(false)
    removeAll()
  }

  // A plain function, not a component: a component declared in the render
  // body is a new type on every render, so React unmounts and remounts it
  // — which would drop keyboard focus the moment the label changes to
  // "Tap again to clear", i.e. exactly when focus matters most.
  const clearAllButton = () => (
    <button type="button" className="lhx-notif-mark" onClick={clearAll}>
      {confirming ? 'Tap again to clear' : 'Clear all'}
    </button>
  )

  const { today, earlier } = useMemo(() => {
    const cutoff = startOfToday()
    const t = []
    const e = []
    for (const n of notifications || []) {
      (toMillis(n.createdAt) >= cutoff ? t : e).push(n)
    }
    return { today: t, earlier: e }
  }, [notifications])

  function openNotification(n) {
    if (!n.read) markRead(n.id)
    const url = n?.action?.url
    if (url && typeof url === 'string' && url.startsWith('/')) navigate(url)
  }

  const empty = !loading && (notifications || []).length === 0

  return (
    <div>
      <SeoHelmet title="Notifications" path="/notifications" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Home" onClick={() => navigate('/dashboard')}>‹</button>
        <div className="lhx-back-title">Notifications</div>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={76} className="lhx-skel" style={{ borderRadius: 24 }} />
          ))}
        </div>
      ) : empty ? (
        <div className="lhx-card" style={{ padding: 24, textAlign: 'center' }}>
          <img
            src="/images/characters/poses/zed-celebrate.webp"
            alt=""
            aria-hidden="true"
            style={{ width: 90, height: 112, objectFit: 'contain', margin: '0 auto 10px' }}
          />
          <p className="lhx-back-title" style={{ fontSize: 16 }}>You&rsquo;re all caught up!</p>
          <p className="lhx-notif-text">
            No new notifications right now. We&rsquo;ll ping you when there&rsquo;s something new.
          </p>
        </div>
      ) : (
        <>
          {today.length > 0 && (
            <section aria-label="Today">
              <div className="lhx-notif-head-row">
                <div style={{ fontSize: '12.5px', color: 'var(--lhx-muted)', fontWeight: 800 }}>Today</div>
                {clearAllButton()}
              </div>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                {today.map((n) => <NotifCard key={n.id} n={n} onOpen={openNotification} />)}
              </div>
            </section>
          )}

          {earlier.length > 0 && (
            <section aria-label="Earlier">
              <div className="lhx-notif-head-row">
                <div style={{ fontSize: '12.5px', color: 'var(--lhx-muted)', fontWeight: 800 }}>Earlier</div>
                {today.length === 0 && clearAllButton()}
              </div>
              <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                {earlier.map((n) => <NotifCard key={n.id} n={n} onOpen={openNotification} />)}
              </div>
            </section>
          )}

          {hasMore && (
            <button
              type="button"
              className="lhx-btn lhx-btn-block"
              style={{ background: 'var(--lhx-card)', color: 'var(--lhx-indigo-text)', boxShadow: 'var(--lhx-shadow)' }}
              onClick={loadMore}
            >
              Show earlier notifications
            </button>
          )}
        </>
      )}
    </div>
  )
}
