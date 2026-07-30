import { useState } from 'react'
import { CircleCheck, CircleX, Eye, SlidersHorizontal, X } from 'lucide-react'
import { TOUR_REPLAY_EVENT, TOUR_STORAGE_KEY } from './onboardingTourCore'

/**
 * Preview-only chrome: the "Preview Mode" banner and (outside production
 * builds) a small control panel for exercising interaction states —
 * greeting override, CTA button state, account menu, logout dialog, toast.
 *
 * The panel is compiled out of production bundles via import.meta.env.PROD
 * so it can never appear on the live site.
 */

export function PreviewBanner() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div className="tdv2-preview-banner" role="status">
      <Eye size={15} strokeWidth={2} aria-hidden="true" />
      Preview Mode — Changes are not live.
      <span className="tdv2-env-tag">Preview</span>
      <button type="button" aria-label="Dismiss preview banner" onClick={() => setDismissed(true)}>
        <X size={13} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
  )
}

const GREETING_CHIPS = [
  { id: null, label: 'Auto' },
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
]

const CTA_CHIPS = [
  { id: 'default', label: 'Default' },
  { id: 'loading', label: 'Loading' },
  { id: 'success', label: 'Success' },
  { id: 'disabled', label: 'Disabled' },
]

export function PreviewControlPanel({
  greetingOverride,
  onGreetingOverride,
  ctaState,
  onCtaState,
  onShowErrorToast,
}) {
  const [open, setOpen] = useState(false)

  // Hard gate: never render in a production build.
  if (import.meta.env.PROD && import.meta.env.MODE === 'production') return null

  return (
    <div className="tdv2-panel">
      <button
        type="button"
        className="tdv2-panel-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SlidersHorizontal size={14} strokeWidth={2} aria-hidden="true" />
        Preview controls
      </button>
      {open ? (
        <div className="tdv2-panel-body">
          <div>
            <div className="tdv2-panel-label">Greeting</div>
            <div className="tdv2-panel-row">
              {GREETING_CHIPS.map(({ id, label }) => (
                <button
                  key={label}
                  type="button"
                  className={`tdv2-chip ${greetingOverride === id ? 'is-on' : ''}`}
                  onClick={() => onGreetingOverride(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="tdv2-panel-label">Continue-plan button</div>
            <div className="tdv2-panel-row">
              {CTA_CHIPS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`tdv2-chip ${ctaState === id ? 'is-on' : ''}`}
                  onClick={() => onCtaState(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            {/* The logout dialog is the shell's, not the page's, so there is
                no longer a page-level handle to open it from here — the
                sidebar's account menu opens the real one. */}
            <div className="tdv2-panel-label">Dialogs &amp; toasts</div>
            <div className="tdv2-panel-row">
              <button type="button" className="tdv2-chip" onClick={onShowErrorToast}>
                Error toast
              </button>
              <button
                type="button"
                className="tdv2-chip"
                onClick={() => {
                  try { localStorage.removeItem(TOUR_STORAGE_KEY) } catch { /* ignore */ }
                  window.dispatchEvent(new Event(TOUR_REPLAY_EVENT))
                }}
              >
                Replay tour
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`tdv2-toast is-${toast.kind}`} role="status">
      {toast.kind === 'error' ? (
        <CircleX size={17} strokeWidth={2} aria-hidden="true" />
      ) : (
        <CircleCheck size={17} strokeWidth={2} aria-hidden="true" />
      )}
      {toast.message}
    </div>
  )
}
