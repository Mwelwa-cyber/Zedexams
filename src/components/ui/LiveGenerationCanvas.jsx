import { useState, useEffect, useRef } from 'react'
import {
  buildSections,
  buildTimeline,
  computeTimelineStatus,
  TOOL_SECTION_CONFIG,
} from './liveGenerationSections'
import LiveGenerationSectionValue from './LiveGenerationSectionValue'
import { useLiveReveal } from '../../hooks/useLiveReveal'

/**
 * LiveGenerationCanvas — the shared "watch it being built" preview for every AI
 * teacher studio.
 *
 * Instead of a spinner-then-dump, it turns the right-hand output panel into a
 * live canvas: a friendly progress timeline with checkmarks on one side, and the
 * document appearing section by section on the other. When the reveal finishes,
 * an action bar offers Continue editing / Save to library / Regenerate, and each
 * revealed section carries its own "Regenerate section" control.
 *
 * It is a drop-in for a studio's existing output `<section>`: the studio keeps
 * its own final View + export buttons untouched and simply flips to them when the
 * teacher clicks "Continue editing" (`onContinueEditing`).
 *
 * The reveal is a paced unveiling of the *real* model output (the generators
 * return the whole document at once, or stream token counts) — nothing is
 * invented. See `liveGenerationSections.js` for the pure sectioning/timeline
 * logic and `useLiveReveal` for the timing state machine.
 *
 * Props
 *   tool            — TOOL_SECTION_CONFIG key ('worksheet' | 'notes' | …).
 *   status          — 'idle' | 'generating' | 'success' | 'error'.
 *   result          — the generated document object (source of sections).
 *   docTitle        — the document's own title (from its header), shown on top.
 *   title/subtitle  — canvas headline + optional secondary line.
 *   emptyState      — node shown when idle.
 *   errorMessage    — shown in the error state.
 *   progress        — optional SSE progress ({ phase, approxOutputTokens, elapsedMs }).
 *   livePreview     — optional node rendered in the preview area in place of the
 *                     generic section reveal, so a studio can show its own real
 *                     document preview (e.g. the printed scheme-of-work page)
 *                     building live. When set, the generic section reveal + its
 *                     per-section regenerate controls are not shown.
 *   sectionConfig   — override for TOOL_SECTION_CONFIG[tool].
 *   savedToLibrary  — reflect the saved-to-library state on the Save button.
 *   saving          — Save button busy state.
 *   onStop          — Stop Generation (during generating).
 *   onRegenerate    — regenerate the whole document.
 *   onRegenerateSection — async (sectionId) => freshResult|void; swaps one section.
 *                         Must return the updated result object on success, or a
 *                         falsy value on failure. A falsy return (or a throw) shows
 *                         an inline "Could not rewrite this section" notice in place
 *                         of a silent no-op.
 *   onSaveToLibrary — async () => void; explicit save.
 *   onContinueEditing — hand off to the studio's full editable/export View.
 *   onRetry         — retry after an error.
 *   continueLabel   — label for the hand-off button (default "Continue editing").
 *   variant         — 'panel' (default; full studio-card panel, mobile full-screen)
 *                     or 'embedded' (bare, for dropping inside an existing modal —
 *                     no card chrome, no mobile overlay, static action bar).
 */
export default function LiveGenerationCanvas({
  tool,
  status = 'idle',
  result = null,
  docTitle,
  title = 'Live generation',
  subtitle,
  emptyState = null,
  errorMessage = '',
  progress = null,
  livePreview = null,
  sectionConfig,
  savedToLibrary = false,
  saving = false,
  variant = 'panel',
  onStop,
  onRegenerate,
  onRegenerateSection,
  onSaveToLibrary,
  onContinueEditing,
  onRetry,
  continueLabel = 'Continue editing',
}) {
  const config = sectionConfig || TOOL_SECTION_CONFIG[tool] || {}
  const embedded = variant === 'embedded'

  // Sections derived from the result, but held in local state so a per-section
  // regenerate can swap a single section without re-revealing the whole doc.
  const [sections, setSections] = useState([])
  const [busySection, setBusySection] = useState(null)
  // Tracks which section (by id) most recently failed to regenerate, so the
  // canvas can show an inline notice without relying on the studio to surface it.
  const [sectionError, setSectionError] = useState(null)
  const resultRef = useRef(result)

  useEffect(() => {
    resultRef.current = result
    if (status === 'success' && result) {
      setSections(buildSections(result, config))
    } else if (status !== 'success') {
      setSections([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, status])

  const timeline = buildTimeline(sections, config)
  const { phase, prepIndex, revealedCount, complete } = useLiveReveal({
    status,
    sectionCount: sections.length,
  })

  const timelineItems = computeTimelineStatus({
    timeline,
    prepIndex,
    revealedCount,
    totalSections: sections.length,
    complete,
    errored: status === 'error',
  })

  async function handleRegenerateSection(sectionId) {
    if (!onRegenerateSection || busySection) return
    setSectionError(null)
    setBusySection(sectionId)
    try {
      const fresh = await onRegenerateSection(sectionId)
      if (fresh && typeof fresh === 'object') {
        const rebuilt = buildSections(fresh, config)
        const replacement = rebuilt.find((s) => s.id === sectionId)
        if (replacement) {
          setSections((prev) => prev.map((s) => (s.id === sectionId ? replacement : s)))
        }
      } else {
        // falsy result: studio's regeneration failed without throwing
        setSectionError(sectionId)
      }
    } catch {
      setSectionError(sectionId)
    } finally {
      setBusySection(null)
    }
  }

  const active = status === 'generating' || status === 'success'
  const hasActions = Boolean(onContinueEditing || onSaveToLibrary || onRegenerate)

  // Mobile: the panel canvas opens as a full-screen preview once Generate is
  // clicked, and stays full-screen when an error occurs so the teacher sees the
  // error message + retry button rather than a card below the fold.
  // The embedded variant (inside a modal) skips the overlay + chrome.
  // NOTE: only the overlay condition includes 'error'; `active` must stay
  // generating|success-only because it also gates the header/timeline/sections block.
  const overlay = (active || status === 'error') && !embedded
    ? 'max-md:fixed max-md:inset-0 max-md:z-[70] max-md:rounded-none max-md:m-0 max-md:min-h-screen max-md:overflow-y-auto'
    : ''
  const wrapperClass = embedded
    ? ''
    : `studio-card p-5 min-h-[400px] ${overlay}`

  const subtitleText = subtitle || progressSubtitle(progress)

  return (
    <section className={wrapperClass}>
      {/* Idle */}
      {status === 'idle' && emptyState}

      {/* Error */}
      {status === 'error' && (
        <ErrorState message={errorMessage} onRetry={onRetry} />
      )}

      {active && (
        <div className="flex flex-col gap-5 h-full">
          {/* Header */}
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-widest theme-text-secondary">
                {phase === 'complete' ? '✓ Ready' : phase === 'preparing' ? 'Getting started' : 'Building live'}
              </p>
              <h2 className="studio-display truncate" style={{ fontSize: 20, margin: '2px 0 0' }}>
                {docTitle || title}
              </h2>
              {subtitleText && (
                <p className="text-xs theme-text-muted mt-0.5">{subtitleText}</p>
              )}
            </div>
            {status === 'generating' && onStop && (
              <button
                type="button"
                onClick={onStop}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl border-2 text-danger px-3.5 py-2 text-sm font-bold transition-colors hover:bg-danger hover:text-white"
                style={{ borderColor: 'var(--danger)' }}
              >
                ✕ Stop generation
              </button>
            )}
          </header>

          {/* Timeline */}
          <Timeline items={timelineItems} compact={phase !== 'preparing'} />

          {/* Live preview — a studio-supplied document preview (e.g. the real
              printed scheme-of-work page) takes over from the generic reveal
              when provided, so teachers watch their actual document build. */}
          {livePreview ? (
            <div className="flex-1 min-w-0">{livePreview}</div>
          ) : sections.length > 0 && (
            <div className="flex-1">
              <div className="space-y-4">
                {sections.slice(0, Math.max(revealedCount, complete ? sections.length : revealedCount)).map((s) => (
                  <RevealSection
                    key={s.id}
                    section={s}
                    canRegenerate={complete && Boolean(onRegenerateSection)}
                    busy={busySection === s.id}
                    anyBusy={Boolean(busySection)}
                    failed={sectionError === s.id}
                    onRegenerate={() => handleRegenerateSection(s.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Action bar (complete) */}
          {complete && hasActions && (
            <div className={embedded
              ? 'mt-2 border-t theme-border pt-3'
              : 'sticky bottom-0 -mx-5 -mb-5 mt-2 border-t theme-border bg-inherit'}>
              <div className={embedded
                ? 'flex flex-wrap items-center gap-2'
                : 'studio-card !rounded-none !shadow-none flex flex-wrap items-center gap-2 px-5 py-3'}>
                {onContinueEditing && (
                  <button
                    type="button"
                    onClick={onContinueEditing}
                    className="studio-btn-primary"
                  >
                    ✏️ {continueLabel}
                  </button>
                )}
                {onSaveToLibrary && (
                  <button
                    type="button"
                    onClick={onSaveToLibrary}
                    disabled={saving || savedToLibrary}
                    className="studio-btn-ghost"
                  >
                    {savedToLibrary ? '✓ Saved to library' : saving ? 'Saving…' : '💾 Save to library'}
                  </button>
                )}
                {onRegenerate && (
                  <button
                    type="button"
                    onClick={onRegenerate}
                    disabled={Boolean(busySection)}
                    className="studio-btn-ghost"
                  >
                    ↻ Regenerate all
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/* ── timeline ──────────────────────────────────────────────────── */

function Timeline({ items, compact }) {
  return (
    <ol
      className={`rounded-2xl theme-bg-subtle p-3 ${compact ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1' : 'space-y-1'}`}
      role="list"
      aria-label="Generation progress"
    >
      {items.map((step) => (
        <TimelineRow key={step.id} step={step} />
      ))}
    </ol>
  )
}

function TimelineRow({ step }) {
  const { status, label, icon } = step
  const done = status === 'done'
  const active = status === 'active'
  const errored = status === 'error'

  return (
    <li
      className="flex items-center gap-2.5 rounded-lg px-1.5 py-1"
      aria-current={active ? 'step' : undefined}
    >
      <span
        className={[
          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs',
          done ? 'bg-emerald-600 text-white'
            : errored ? 'bg-danger text-white'
            : active ? 'theme-accent-fill theme-on-accent'
            : 'theme-card theme-text-muted border theme-border',
        ].join(' ')}
        aria-hidden="true"
      >
        {done ? '✓' : errored ? '!' : active ? <MiniSpinner /> : icon}
      </span>
      <span
        className={[
          'text-sm font-semibold flex-1 min-w-0 truncate',
          done ? 'theme-text-muted line-through decoration-1'
            : errored ? 'text-danger'
            : active ? 'theme-text'
            : 'theme-text-muted',
        ].join(' ')}
      >
        {label}
      </span>
    </li>
  )
}

/* ── revealed section ──────────────────────────────────────────── */

function RevealSection({ section, canRegenerate, busy, anyBusy, failed, onRegenerate }) {
  return (
    <div className="animate-slide-in-soft">
      <div className="flex items-center justify-between gap-2 mb-2 border-b theme-border pb-1">
        <h3 className="text-base font-black theme-text flex items-center gap-2 min-w-0">
          <span aria-hidden="true">{section.icon}</span>
          <span className="truncate">{section.title}</span>
        </h3>
        {canRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={anyBusy}
            className="flex-shrink-0 text-xs font-bold theme-text-muted hover:theme-text underline decoration-dotted disabled:opacity-50"
            title={`Regenerate ${section.title}`}
          >
            {busy ? 'Regenerating…' : '↻ Regenerate section'}
          </button>
        )}
      </div>
      {busy ? (
        <div className="py-4 flex items-center gap-2 text-sm theme-text-muted">
          <MiniSpinner /> Rewriting this section…
        </div>
      ) : failed ? (
        <p className="text-sm text-danger py-2">
          Could not rewrite this section — please try again.
        </p>
      ) : (
        <LiveGenerationSectionValue value={section.value} />
      )}
    </div>
  )
}

/* ── error ─────────────────────────────────────────────────────── */

function ErrorState({ message, onRetry }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center h-full py-12 text-center">
      <div className="text-5xl mb-3" aria-hidden="true">⚠️</div>
      <h3 className="studio-display" style={{ fontSize: 20 }}>Something went wrong</h3>
      <p className="text-sm max-w-md mb-3 mt-1 theme-text-muted">
        {message || 'Generation failed. Your request is saved — nothing was lost.'}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="studio-btn-ghost mt-1">
          ↻ Try again
        </button>
      )}
    </div>
  )
}

/* ── bits ──────────────────────────────────────────────────────── */

function MiniSpinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 text-current" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

function progressSubtitle(progress) {
  if (!progress) return undefined
  const tokens = progress.approxOutputTokens
  const seconds = progress.elapsedMs ? Math.round(progress.elapsedMs / 1000) : null
  const parts = []
  if (tokens) parts.push(`~${tokens.toLocaleString()} words drafted`)
  if (seconds != null && progress.phase && progress.phase !== 'queued') parts.push(`${seconds}s`)
  return parts.length ? parts.join(' · ') : undefined
}
