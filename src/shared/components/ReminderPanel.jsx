import { Link } from 'react-router-dom'

/**
 * The reminders dropdown card for the teacher bell (TeacherTopBar; it was
 * shared with the mobile TeacherGlassHeader until Phase 6 deleted that dead
 * V1 header — MobileChrome owns the mobile shell). The caller positions it via
 * `className` (absolute/right/width); this renders the card, header, and
 * list. `onNavigate` fires when a reminder is tapped so the caller can close
 * its dropdown.
 */
export default function ReminderPanel({ reminders, onNavigate, className = '' }) {
  return (
    <div
      className={`theme-card theme-border rounded-2xl border shadow-xl ${className}`}
      style={{ maxHeight: 420, overflowY: 'auto' }}
    >
      <div className="theme-border border-b px-4 py-3">
        <p className="theme-text text-sm font-black" style={{ fontFamily: "'Fraunces', serif" }}>
          Reminders
        </p>
        <p className="theme-text-muted text-xs">
          Personalised nudges based on your activity.
        </p>
      </div>
      {reminders.length === 0 ? (
        <div className="theme-text-muted p-6 text-center text-sm">
          <div className="mb-2" style={{ fontSize: 28, opacity: 0.5 }}>🔔</div>
          You're all caught up.
        </div>
      ) : (
        <ul>
          {reminders.map((r) => {
            const dot = r.tone === 'warn' ? '#d97757' : r.tone === 'good' ? '#10864e' : '#16505d'
            return (
              <li key={r.id} className="theme-border border-t first:border-t-0">
                <Link
                  to={r.to}
                  onClick={onNavigate}
                  className="hover:theme-bg-subtle flex items-start gap-3 px-4 py-3 no-underline transition-colors"
                >
                  <span
                    className="mt-1 flex-shrink-0 rounded-full"
                    style={{ background: dot, width: 8, height: 8 }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="theme-text block text-sm font-bold">{r.title}</span>
                    <span className="theme-text-muted mt-0.5 block text-xs" style={{ lineHeight: 1.4 }}>{r.body}</span>
                    <span className="mt-1.5 inline-block text-xs font-bold" style={{ color: '#d97757' }}>{r.cta} →</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
