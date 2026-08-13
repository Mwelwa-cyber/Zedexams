import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  ListChecks,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import { iconForTool } from '../../../shared/constants/dashboardV2Config'
import { progressFraction } from '../lib/dashboardV2Core'

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
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        style={{ stroke: 'var(--ring-track, #efe7d9)' }}
        strokeWidth="3.5"
      />
      <circle
        cx="15"
        cy="15"
        r={r}
        fill="none"
        stroke="#aa5943"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        transform="rotate(-90 15 15)"
      />
    </svg>
  )
}

/** items: [{ id, label, done, total, to }] */
export function ChecklistCard({ items = [], loading = false }) {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-check-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-check-h">
          <ListChecks size={17} strokeWidth={2} aria-hidden="true" />
          Checklist Completion
        </h2>
      </div>
      {loading ? (
        <div className="tdv2-empty">Working out your week…</div>
      ) : items.length === 0 ? (
        <div className="tdv2-empty">
          No weekly plan yet — set up your week from a Scheme of Work.
        </div>
      ) : (
        items.map(({ id, label, done, total, to }) => {
          const fraction = progressFraction(done, total)
          const inner = (
            <>
              <ProgressRing fraction={fraction} />
              <span className="tdv2-check-label">
                {label}
                <span className="tdv2-check-bar" aria-hidden="true">
                  <span style={{ width: `${fraction * 100}%` }} />
                </span>
              </span>
              <span className="tdv2-check-count">{done}/{total}</span>
            </>
          )
          return to ? (
            <Link key={id} to={to} className="tdv2-check-row">{inner}</Link>
          ) : (
            <div key={id} className="tdv2-check-row">{inner}</div>
          )
        })
      )}
      <Link className="tdv2-footer-action" to="/teacher/generate/weekly-forecast">
        <ClipboardCheck size={16} strokeWidth={1.75} aria-hidden="true" />
        View full checklist
      </Link>
    </section>
  )
}

const FEED_ICONS = { success: CircleCheck, warning: TriangleAlert, error: CircleX }

/** items: [{ id, kind, title, body, retry?, to? }] */
export function FeedStatusCard({ items = [], onRetry }) {
  return (
    <section className="tdv2-card" aria-labelledby="tdv2-feed-h">
      <div className="tdv2-card-head">
        <h2 className="tdv2-eyebrow" id="tdv2-feed-h">
          <Activity size={17} strokeWidth={2} aria-hidden="true" />
          Feed &amp; Status
        </h2>
      </div>
      {items.length === 0 ? (
        <div className="tdv2-empty">You’re all caught up.</div>
      ) : (
        items.map(({ id, kind, title, body, retry }) => {
          const FeedIcon = FEED_ICONS[kind] || CircleCheck
          return (
            <div key={id} className={`tdv2-feed-item is-${kind}`}>
              <FeedIcon size={18} strokeWidth={2} className="tdv2-feed-icon" aria-hidden="true" />
              <div>
                {/* kind is conveyed by icon + wording, never colour alone */}
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
          )
        })
      )}
    </section>
  )
}

/** items: [{ id, title, meta, time, tool, to }] */
export function RecentActivityCard({ items = [] }) {
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
      {items.length === 0 ? (
        <div className="tdv2-empty">Your recent work will show up here.</div>
      ) : (
        items.map(({ id, title, meta, time, tool, to }) => {
          const RowIcon = iconForTool(tool)
          return (
            <Link key={id} to={to || '/teacher/library'} className="tdv2-activity-row">
              <span className="tdv2-activity-icon" aria-hidden="true">
                <RowIcon size={17} strokeWidth={1.75} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="tdv2-activity-title" style={{ display: 'block' }}>{title}</span>
                <span className="tdv2-activity-meta" style={{ display: 'block' }}>{meta}</span>
              </span>
              <span className="tdv2-activity-time">{time}</span>
            </Link>
          )
        })
      )}
    </section>
  )
}
