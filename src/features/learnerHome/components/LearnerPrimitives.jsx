/**
 * Shared learner-home primitives: progress bars/rings and the loading /
 * empty / error states every section is required to have (spec §20).
 * No fake values ever — callers pass real numbers or render EmptyState.
 */
import { RefreshCw, WifiOff } from 'lucide-react'
import LearnerIcon from './LearnerIcon'

export function ProgressBar({ percent, label, tone = '', white = false }) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
  return (
    <div
      className="lhx-track"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || `${value}% complete`}
    >
      <div
        className={`lhx-fill ${white ? 'lhx-fill-white' : ''}`}
        style={{ width: `${value}%`, ...(tone ? { background: tone } : {}) }}
      />
    </div>
  )
}

export function ProgressRing({ percent, size = 56, stroke = 5, tone = 'var(--lhx-green)', label }) {
  const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span
      className="lhx-ring"
      role="img"
      aria-label={label || `${value}% complete`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(23,32,58,0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
        />
      </svg>
      <span className="lhx-ring-label">{value}%</span>
    </span>
  )
}

export function EmptyState({ icon = 'learn', children }) {
  return (
    <div className="lhx-empty">
      <span className="lhx-empty-icon"><LearnerIcon name={icon} size={24} /></span>
      {children}
    </div>
  )
}

export function ErrorState({ children = 'Something went wrong loading this section.', onRetry }) {
  return (
    <div className="lhx-error" role="alert">
      <p className="lhx-error-text">{children}</p>
      {onRetry && (
        <button type="button" className="lhx-btn lhx-btn-sm lhx-btn-soft" onClick={onRetry}>
          <RefreshCw size={18} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  )
}

export function SectionSkeleton({ lines = 3, height = 14 }) {
  return (
    <div aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="lhx-skel" style={{ height, width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}

export function OfflineBadge() {
  return (
    <div className="lhx-offline" role="status">
      <WifiOff size={18} aria-hidden="true" />
      You’re offline — showing saved data. Progress will sync when you reconnect.
    </div>
  )
}
