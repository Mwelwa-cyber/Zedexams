import { ShieldCheckIcon, ArrowPathIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import './sessionRestorationScreen.css'

/**
 * SessionRestorationScreen — the branded loader shown while the Firebase
 * session + Firestore profile resolve on a cold start / reload (chiefly
 * /teacher, via ProtectedRoute).
 *
 * PURELY PRESENTATIONAL. All auth/network state and callbacks come through
 * props (derived by useSessionRestoration); this component holds NO Firebase
 * logic, so it renders in isolation for tests and Storybook-style previews.
 *
 * The progress bar is deliberately INDETERMINATE — Firebase auth restoration
 * exposes no real percentage, so we never fabricate one (e.g. "65%").
 *
 * No token, email, UID, or profile field is ever rendered here.
 */

// Stage → copy. Exported so tests assert against the single source of truth
// rather than duplicating the strings.
export const STAGE_COPY = {
  'restoring-auth':    { title: 'Restoring your session…',      subtitle: 'Checking your saved session.' },
  'loading-profile':   { title: 'Loading your teaching profile…', subtitle: 'Fetching your teaching information.' },
  'loading-dashboard': { title: 'Preparing your dashboard…',     subtitle: 'Preparing your teacher workspace.' },
  'complete':          { title: 'Ready',                          subtitle: 'Your dashboard is ready.' },
  'offline':           { title: 'You appear to be offline',       subtitle: 'Check your internet connection and try again.' },
  'timeout':           { title: 'This is taking longer than expected', subtitle: 'Please check your connection or try again.' },
  'error':             { title: 'We could not restore your session',  subtitle: 'Your session could not be restored safely.' },
}

// Stages that are "still working" (spinner + live indeterminate bar) vs
// terminal states that surface the recovery card and a stalled bar.
const TERMINAL_STAGES = new Set(['offline', 'timeout', 'error'])

// Persistent, reassuring line kept under the loader in terminal states — so the
// branded loader still reads as "your session" while the recovery card below
// carries the specific issue + actions (mirrors the design mockup).
const NEUTRAL_COPY = { title: 'Restoring your session…', subtitle: 'Your dashboard will be ready shortly.' }

function LoaderRing() {
  // Decorative — hidden from assistive tech (the status text carries meaning).
  // A soft orange glow, a faint track ring, two counter-offset arcs (brand blue
  // + brand orange, each with a leading dot), and the ZedExams app-icon badge
  // at the centre.
  return (
    <div className="zsr__loader" aria-hidden="true">
      <div className="zsr__glow" />
      <svg className="zsr__ring" viewBox="0 0 160 160" role="presentation">
        <circle className="zsr__ring-track" cx="80" cy="80" r="72" />
        <g className="zsr__ring-arc zsr__ring-arc--blue">
          <circle className="zsr__ring-stroke zsr__ring-stroke--blue" cx="80" cy="80" r="72" />
          <circle className="zsr__ring-dot zsr__ring-dot--blue" cx="80" cy="8" r="6" />
        </g>
        <g className="zsr__ring-arc zsr__ring-arc--orange">
          <circle className="zsr__ring-stroke zsr__ring-stroke--orange" cx="80" cy="80" r="72" />
          <circle className="zsr__ring-dot zsr__ring-dot--orange" cx="80" cy="152" r="6" />
        </g>
      </svg>
      <img
        className="zsr__badge"
        src="/zedexams-app-icon.jpg?v=1"
        alt=""
        aria-hidden="true"
        width="64"
        height="64"
        draggable="false"
      />
    </div>
  )
}

function DashboardSkeleton() {
  // Faint, non-interactive teacher-dashboard placeholder shown behind the
  // loader once auth has succeeded. aria-hidden so it never reaches the
  // accessibility tree. The sidebar column is CSS-hidden on phones.
  return (
    <div className="zsr__skeleton" aria-hidden="true">
      <div className="zsr__sk-topbar">
        <div className="zsr__sk zsr__sk--logo" />
        <div style={{ flex: 1 }} />
        <div className="zsr__sk zsr__sk--line" style={{ width: 120 }} />
        <div className="zsr__sk zsr__sk--line" style={{ width: 36, height: 36, borderRadius: '50%' }} />
      </div>
      <div className="zsr__sk-body">
        <div className="zsr__sk-sidebar">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="zsr__sk zsr__sk--pill" />
          ))}
        </div>
        <div className="zsr__sk-main">
          <div className="zsr__sk zsr__sk--title" />
          <div className="zsr__sk-cards">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="zsr__sk-card" />
            ))}
          </div>
          <div className="zsr__sk-rows">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="zsr__sk zsr__sk--row" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SessionRestorationScreen({
  stage = 'restoring-auth',
  error = null,
  retrying = false,
  leaving = false,
  onRetry,
  onReturnToSignIn,
  showDashboardSkeleton = false,
}) {
  const copy = STAGE_COPY[stage] || STAGE_COPY['restoring-auth']
  const isTerminal = TERMINAL_STAGES.has(stage)
  // In terminal states the loader keeps a calm, branded message; the recovery
  // card owns the specific problem + actions (no duplicated headline).
  const loaderCopy = isTerminal ? NEUTRAL_COPY : copy

  // Only expose the desktop-sidebar skeleton once we're genuinely past the
  // unknown-auth stage — never during 'restoring-auth', so a signed-out
  // visitor can't glimpse an authenticated layout.
  const skeletonVisible = showDashboardSkeleton && stage !== 'restoring-auth'

  return (
    <div
      className={
        'zsr' +
        (leaving ? ' zsr--leaving' : '') +
        (skeletonVisible ? ' zsr--with-skeleton' : '')
      }
      // Working states are a polite status region; terminal states are an
      // alert so a screen reader announces the recovery options promptly.
      role={isTerminal ? 'alert' : 'status'}
      aria-live={isTerminal ? 'assertive' : 'polite'}
      aria-busy={isTerminal ? undefined : 'true'}
    >
      {skeletonVisible ? <DashboardSkeleton /> : null}

      <div className="zsr__card">
        <LoaderRing />

        {/* key forces a re-mount so the copy cross-fades between stages. */}
        <div className="zsr__message" key={isTerminal ? 'neutral' : stage}>
          <p className="zsr__title">{loaderCopy.title}</p>
          <p className="zsr__subtitle">{loaderCopy.subtitle}</p>
        </div>

        <div className={'zsr__bar' + (isTerminal ? ' zsr__bar--stalled' : '')} aria-hidden="true">
          <div className="zsr__bar-fill" />
        </div>

        <div className="zsr__trust">
          <ShieldCheckIcon aria-hidden="true" />
          <span>Secure&nbsp;•&nbsp;Private&nbsp;•&nbsp;Encrypted</span>
        </div>
      </div>

      {isTerminal ? (
        <div className="zsr__recovery" role="group" aria-label="Session recovery options">
          <p className="zsr__recovery-title">{copy.title}</p>
          <p className="zsr__recovery-text">
            {stage === 'error' ? 'Your account is safe. Please try again.' : copy.subtitle}
          </p>
          <div className="zsr__actions">
            <button
              type="button"
              className="zsr__btn zsr__btn--primary"
              onClick={onRetry}
              disabled={retrying}
              aria-busy={retrying ? 'true' : undefined}
            >
              {retrying ? (
                <>
                  <span className="zsr__btn-spinner" aria-hidden="true" />
                  Retrying…
                </>
              ) : (
                <>
                  <ArrowPathIcon aria-hidden="true" />
                  Try again
                </>
              )}
            </button>
            <button
              type="button"
              className="zsr__btn zsr__btn--ghost"
              onClick={onReturnToSignIn}
              disabled={retrying}
            >
              Return to sign in
              <ChevronRightIcon aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Dev-only technical detail — kept out of the UI copy and prod logs.
          error is a short code string, never a token/email/UID. */}
      {error && import.meta.env.DEV ? (
        <p style={{ position: 'absolute', bottom: 8, fontSize: 11, color: 'var(--zsr-navy-soft)', opacity: 0.7 }}>
          debug: {String(error)}
        </p>
      ) : null}
    </div>
  )
}
