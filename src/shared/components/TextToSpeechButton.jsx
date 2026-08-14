/**
 * TextToSpeechButton — a compact read-aloud control for a single quiz item
 * (question, passage, or answer option). Renders nothing unless read-aloud is
 * enabled (the `readAloud` reading preference), so audio never plays without
 * the learner opting in.
 *
 * Idle:    a speaker button that starts reading this item.
 * Playing: a pause button + a stop button.
 * Paused:  a resume (play) button + a stop button.
 *
 * All three are real <button>s with aria-labels so the control is fully
 * keyboard- and screen-reader-accessible and never signals state by icon alone.
 */

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

const BASE =
  'inline-flex h-8 min-w-[32px] items-center justify-center gap-1 rounded-full border-2 border-slate-900/70 bg-white/90 px-2 text-slate-800 shadow-[0_1px_0_#0F1B2D] transition-transform active:translate-y-0.5'

export default function TextToSpeechButton({ id, getText, tts, label = 'text', className = '' }) {
  if (!tts?.enabled) return null

  const active = tts.isActive(id)

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => tts.toggle(id, getText)}
        aria-label={`Read ${label} aloud`}
        title={`Read ${label} aloud`}
        className={`${BASE} ${className}`}
      >
        <SpeakerIcon />
      </button>
    )
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`} role="group" aria-label={`Reading ${label} aloud`}>
      {tts.paused ? (
        <button type="button" onClick={tts.resume} aria-label="Resume reading" title="Resume" className={BASE}>
          <PlayIcon />
        </button>
      ) : (
        <button type="button" onClick={tts.pause} aria-label="Pause reading" title="Pause" className={BASE}>
          <PauseIcon />
        </button>
      )}
      <button type="button" onClick={tts.stop} aria-label="Stop reading" title="Stop" className={`${BASE} text-rose-600`}>
        <StopIcon />
      </button>
    </span>
  )
}
