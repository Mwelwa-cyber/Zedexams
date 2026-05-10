/**
 * CookieConsentBanner — first-visit consent for product analytics
 * (audit D2).
 *
 * Decline-by-default: until the user clicks Accept, the analytics
 * SDK never loads. The banner self-hides once a decision is recorded
 * (Accepted or Declined). The /profile preferences card lets the
 * user flip it later without hunting through cookies.
 *
 * No third-party library — vanilla-cookieconsent is overkill for
 * one toggle, and the design tokens here align with the rest of the
 * app's chrome. ~70 lines including the inline styles.
 */

import { useEffect, useState } from 'react'
import {
  CONSENT_ACCEPTED,
  CONSENT_DECLINED,
  getConsent,
  setConsent,
} from '../../utils/analyticsConsent'

export default function CookieConsentBanner() {
  // Render decision: hidden until effect resolves so the banner
  // doesn't flash on returning visits.
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const decision = getConsent()
    if (decision === null) setVisible(true)
  }, [])

  if (!visible) return null

  function handleAccept() {
    setConsent(CONSENT_ACCEPTED)
    setVisible(false)
  }
  function handleDecline() {
    setConsent(CONSENT_DECLINED)
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-[80] p-3 sm:p-4 pointer-events-none"
    >
      <div className="pointer-events-auto max-w-3xl mx-auto theme-card border theme-border rounded-radius-md shadow-elev-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="theme-text font-black text-sm flex items-center gap-2">
            <span aria-hidden="true">🍪</span>
            Help us improve ZedExams?
          </p>
          <p className="theme-text-muted text-xs mt-1 leading-snug">
            We&apos;d like to use a privacy-friendly product analytics tool to
            see which lessons help most. We don&apos;t share your data and you
            can change this any time on your{' '}
            <a href="/profile" className="theme-accent-text font-bold underline">profile</a>.
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={handleDecline}
            className="rounded-full border-2 theme-border theme-text-muted bg-transparent px-3 py-1.5 text-xs font-bold hover:theme-bg-subtle hover:theme-text"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="theme-accent-fill theme-on-accent rounded-full px-3 py-1.5 text-xs font-bold shadow-sm hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
