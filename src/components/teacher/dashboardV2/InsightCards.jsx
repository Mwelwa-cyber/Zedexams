import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  ClipboardCheck,
  ListChecks,
  RotateCcw,
} from 'lucide-react'
import { ACTIVITY_ITEMS, CHECKLIST_ITEMS, FEED_ITEMS } from './mockData'
import { progressFraction } from './dashboardV2Core'

function ProgressRing({ fraction }) {
  const r = 12
  const c = 2 * Math.PI * r
  return (
    <svg
      className="tdv2-ring"
      width="30"
      height="30"
      viewBox="0 0 30 30"
      role="img"
      aria-label={`${Math.round(fraction * 100)}% complete`}
    >
      <circle cx="15" cy="15" r={r} fill="none" stroke="#efe7d9" strokeWidth="3.5" />
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        stroke="#c65a24"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        transform="rotate(-90 15 15)"
      />
    </svg>
  )
}

export function ChecklistCard() {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-check-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-check-h">
          <ListChecks size={17} strokeWidth={2} aria-hidden="true" />
          Checklist Completion
        </h2>
      </div>
      {CHECKLIST_ITEMS.map(({ id, label, done, total }) => {
        const fraction = progressFraction(done, total)
        return (
          <div key={id} className="tdv2-check-row">
            <ProgressRing fraction={fraction} />
            <span className="tdv2-check-label">
              {label}
              <span className="tdv2-check-bar" aria-hidden="true">
                <span style={{ width: `${fraction * 100}%` }} />
              </span>
            </span>
            <span className="tdv2-check-count">{done}/{total}</span>
          </div>
        )
      })}
      <Link className="tdv2-footer-action" to="/teacher/generate/weekly-forecast">
        <ClipboardCheck size={16} strokeWidth={1.75} aria-hidden="true" />
        View full checklist
      </Link>
    </section>
  )
}

export function FeedStatusCard({ onRetry }) {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-feed-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-feed-h">
          <Activity size={17} strokeWidth={2} aria-hidden="true" />
          Feed &amp; Status
        </h2>
      </div>
      {FEED_ITEMS.map(({ id, kind, title, body, icon: FeedIcon, retry }) => (
        <div key={id} className={`tdv2-feed-item is-${kind}`}>
          <FeedIcon size={18} strokeWidth={2} className="tdv2-feed-icon" aria-hidden="true" />
          <div>
            {/* kind is also conveyed by the icon + title, not colour alone */}
            <div className="tdv2-feed-title">{title}</div>
            <div className="tdv2-feed-body">{body}</div>
            {retry ? (
              <button type="button" className="tdv2-retry" onClick={onRetry}>
                <RotateCcw size={13} strokeWidth={2.25} aria-hidden="true" />
                Retry
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  )
}

export function RecentActivityCard() {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-activity-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-activity-h">
          <Activity size={17} strokeWidth={2} aria-hidden="true" />
          Recent Activity
        </h2>
        <Link className="tdv2-link-action" to="/teacher/library">
          View all
          <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>
      {ACTIVITY_ITEMS.map(({ id, title, meta, time, icon: RowIcon }) => (
        <Link key={id} to="/teacher/library" className="tdv2-activity-row">
          <span className="tdv2-activity-icon" aria-hidden="true">
            <RowIcon size={17} strokeWidth={1.75} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="tdv2-activity-title" style={{ display: 'block' }}>{title}</span>
            <span className="tdv2-activity-meta" style={{ display: 'block' }}>{meta}</span>
          </span>
          <span className="tdv2-activity-time">{time}</span>
        </Link>
      ))}
    </section>
  )
}
