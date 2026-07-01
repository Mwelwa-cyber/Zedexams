import { useEffect, useState } from 'react'
import { useGenerationStages } from '../../hooks/useGenerationStages'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'
import { connectionNoticeFor, CONNECTION_NOTICES } from './aiGenerationStages'

/**
 * AiGenerationProgress — the reusable animated tracker shown while an AI tool
 * is generating content. Instead of a blank spinner, it walks the user through
 * the real shape of the run: reading the request → checking the curriculum →
 * generating content → (diagrams) → validating the answer key → preparing the
 * preview.
 *
 * Shared across Assessment, Quiz, Notes, Worksheet, Flashcards, Rubric, Scheme
 * of Work and Homework studios. (The Lesson Plan studio is vanilla JS and has a
 * parallel port in public/studio/ that mirrors this look.)
 *
 * Progress source — automatic:
 *   • By default the stage walk is *simulated* on a time-weighted timeline,
 *     because most generators are single-promise callables with no live
 *     progress. The final stage never auto-completes — it waits for `running`
 *     to flip false.
 *   • Worksheet/Lesson-Plan callers have real SSE phases; they pass
 *     `activeStageId` (see mapWorksheetPhaseToStage) so the tracker reflects the
 *     truth rather than a guess.
 *
 * Props
 *   running       — whether a generation is in flight. Drives the timeline and
 *                   the "all done" snap when it flips false.
 *   preset        — STAGE_PRESETS key ('notes' | 'worksheet' | …) or an explicit
 *                   array of stage ids (use the array form for conditional
 *                   stages like AssessmentStudio's auto-diagrams).
 *   variant       — 'card' (default, inline) | 'modal' | 'panel'.
 *   title         — headline (default "Generating…").
 *   subtitle      — optional secondary line (e.g. Worksheet's token count).
 *   activeStageId — optional real driver; overrides the simulated timeline.
 *   error         — truthy when the run failed; freezes on the active stage and
 *                   surfaces the friendly retry copy below the stages.
 *   onCancel      — optional; renders a Cancel link when provided.
 *   onRetry       — optional; renders a "Try again" button in the failed state.
 *
 * Connection reassurance — automatic, no caller wiring needed:
 *   • Offline mid-run → a calm "your request is saved, it'll continue when you
 *     reconnect" line (Firestore queues the write; the studio keeps the form).
 *   • Still online but the run has dragged on → a "your connection is slow, we
 *     are still working, don't close the page" line. Fires on wall-clock so it
 *     works for both the simulated timeline and the real-SSE callers.
 */
export default function AiGenerationProgress({
  running = true,
  preset = 'notes',
  variant = 'card',
  title = 'Generating…',
  subtitle,
  activeStageId,
  error,
  onCancel,
  onRetry,
}) {
  const { items, percent, reducedMotion } = useGenerationStages({
    running,
    preset,
    activeStageId,
    error,
  })

  // Wall-clock since the current run began, tracked independently of the stage
  // timeline so the "slow connection" notice works even for SSE-driven callers
  // that pass activeStageId (where the stage ticker stays put).
  const online = useNetworkStatus()
  const [runMs, setRunMs] = useState(0)
  useEffect(() => {
    if (!running) {
      setRunMs(0)
      return undefined
    }
    const start = Date.now()
    const id = setInterval(() => setRunMs(Date.now() - start), 1000)
    return () => clearInterval(id)
  }, [running])

  const notice = connectionNoticeFor({
    online,
    elapsedMs: runMs,
    running,
    errored: Boolean(error),
  })

  const body = (
    <div
      className="w-full max-w-md mx-auto"
      role="status"
      aria-live="polite"
      aria-label={`${title} ${percent}% complete`}
    >
      {/* Heading */}
      <div className="text-center mb-5">
        <div
          className={`text-4xl mb-2 ${reducedMotion ? '' : 'animate-bounce'}`}
          aria-hidden="true"
        >
          {error ? '⚠️' : '✨'}
        </div>
        <h3 className="text-display-md theme-text font-black">{title}</h3>
        {subtitle && (
          <p className="text-body-sm theme-text-muted mt-1">{subtitle}</p>
        )}
      </div>

      {/* Overall progress bar */}
      <div
        className="theme-bg-subtle h-1.5 w-full rounded-full overflow-hidden mb-5"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${error ? 'bg-danger' : 'theme-accent-fill'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Stage list */}
      <ol className="space-y-1" role="list">
        {items.map((stage) => (
          <StageRow key={stage.id} stage={stage} reducedMotion={reducedMotion} />
        ))}
      </ol>

      {/* Connection reassurance — offline / slow, while the run is in flight */}
      {notice && !error && (
        <div
          role="status"
          aria-live="polite"
          className="mt-5 flex items-start gap-2.5 rounded-xl theme-bg-subtle px-3.5 py-2.5 text-body-sm theme-text-muted"
        >
          <span className="mt-0.5 flex-shrink-0 text-base leading-none" aria-hidden="true">
            {notice === 'offline' ? '📡' : '⏳'}
          </span>
          <span className="text-left">{CONNECTION_NOTICES[notice]}</span>
        </div>
      )}

      {/* Failed state — reassure that nothing was lost, offer a clean retry */}
      {error && (
        <div className="mt-5 text-center">
          <p className="text-body-sm theme-text-muted">
            Your request is saved — nothing was lost. You can try again.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="theme-accent-fill theme-on-accent mt-3 rounded-xl px-5 py-2.5 text-body-sm font-bold shadow-elev-sm transition-opacity hover:opacity-90"
            >
              ↻ Try again
            </button>
          )}
        </div>
      )}

      {onCancel && (
        <div className="text-center mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="text-body-sm theme-text-muted underline hover:theme-text"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )

  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" aria-hidden="true" />
        <div className="relative w-full max-w-md theme-card theme-border rounded-3xl border shadow-elev-xl p-6 animate-scale-in">
          {body}
        </div>
      </div>
    )
  }

  if (variant === 'panel') {
    return (
      <aside className="theme-card theme-border rounded-2xl border shadow-elev-md p-6 animate-slide-in-soft">
        {body}
      </aside>
    )
  }

  // variant === 'card' (default): self-contained inline block that drops into a
  // studio's existing centered loading slot.
  return (
    <div className="flex items-center justify-center w-full h-full py-10 px-4 animate-fade-in">
      {body}
    </div>
  )
}

/* ── stage row ─────────────────────────────────────────────────── */

function StageRow({ stage, reducedMotion }) {
  const { status, label, icon } = stage
  const done = status === 'done'
  const active = status === 'active'
  const errored = status === 'error'

  return (
    <li
      className={[
        'flex items-center gap-3 rounded-xl px-3 py-2 transition-colors',
        active ? 'theme-bg-subtle' : '',
      ].join(' ')}
      aria-current={active ? 'step' : undefined}
    >
      <span
        className={[
          'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm',
          done ? 'bg-emerald-600 text-white'
            : errored ? 'bg-danger text-white'
            : active ? 'theme-accent-fill theme-on-accent'
            : 'theme-bg-subtle theme-text-muted',
        ].join(' ')}
        aria-hidden="true"
      >
        {done ? '✓' : errored ? '!' : active && !reducedMotion ? (
          <Spinner />
        ) : (
          icon
        )}
      </span>
      <span
        className={[
          'text-body-sm font-semibold flex-1 min-w-0 truncate',
          done ? 'theme-text-muted'
            : errored ? 'text-danger'
            : active ? 'theme-text'
            : 'theme-text-muted',
        ].join(' ')}
      >
        {label}
      </span>
      {active && !errored && (
        <span className="text-eyebrow theme-text-muted flex-shrink-0" aria-hidden="true">
          {reducedMotion ? '…' : 'Working'}
        </span>
      )}
    </li>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-current"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}
