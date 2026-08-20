/**
 * CookieConsentBanner — first-visit consent for product analytics
 * (audit D2).
 *
 * Decline-by-default: until the user clicks Accept, the analytics
 * SDK never loads. The banner self-hides once a decision is recorded
 * (Accepted or Declined). The public /preferences page lets the user
 * flip it later without hunting through cookies — and, unlike the old
 * /profile link, it works for signed-out visitors (who are exactly
 * the audience that sees this banner) instead of bouncing them to a
 * login wall.
 *
 * No third-party library — vanilla-cookieconsent is overkill for
 * one toggle, and the design tokens here align with the rest of the
 * app's chrome. ~70 lines including the inline styles.
 */

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  CONSENT_ACCEPTED,
  CONSENT_DECLINED,
  getConsent,
  setConsent,
} from '../../utils/analyticsConsent'

/**
 * Bottom bars this banner must not cover, in the order it should not
 * matter which one is up: the learner shell's 4-tab bar and the legacy
 * chrome's twin. Both are `position: fixed` at the bottom of the
 * viewport, and this banner is `z-[80]` against their `z-30`/`z-40`.
 */
const BOTTOM_BAR_SELECTOR = '.lhx-nav, nav[aria-label="Primary mobile navigation"]'

export default function CookieConsentBanner() {
  // Render decision: hidden until effect resolves so the banner
  // doesn't flash on returning visits.
  const [visible, setVisible] = useState(false)
  // How much room a bottom bar is taking, if one is mounted at all.
  const [barHeight, setBarHeight] = useState(0)
  const { pathname } = useLocation()

  useEffect(() => {
    const decision = getConsent()
    if (decision === null) setVisible(true)
  }, [])

  /**
   * A child's first screen was this panel pinned over the tab bar
   * (LEARNER_UI_AUDIT L-19) — covering the navigation with a dialog they
   * have to read before they can move.
   *
   * The height is MEASURED rather than taken from `--lhx-nav-h`, which
   * looks like the obvious answer and is the wrong one: that token is
   * declared unconditionally on `:root`, so it reads 76px on `/pricing`
   * and every other page with no bar at all, and the banner would float
   * above nothing. Measuring also means this cannot drift if the bar's
   * height changes, and it answers 0 on the marketing pages by simply
   * finding no bar.
   *
   * Re-measured on navigation because the bars mount and unmount per
   * route. A bar hidden by the auto-hide-on-scroll transform still
   * reports its height, which is what we want — it comes back on the
   * next scroll up, and a banner that moved with it would be worse.
   */
  useEffect(() => {
    if (!visible) return
    const bar = document.querySelector(BOTTOM_BAR_SELECTOR)
    setBarHeight(bar ? Math.round(bar.getBoundingClientRect().height) : 0)
  }, [visible, pathname])

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
      style={{ paddingBottom: `calc(${barHeight}px + env(safe-area-inset-bottom, 0px) + 12px)` }}
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
            see which lessons help most. We don&apos;t share your data — read our{' '}
            <Link to="/privacy" className="theme-accent-text font-bold underline inline-block py-1">Privacy Policy</Link>
            {' '}or change this any time in your{' '}
            <Link to="/preferences" className="theme-accent-text font-bold underline inline-block py-1">privacy preferences</Link>.
          </p>
        </div>
        <div className="flex flex-shrink-0 gap-2 items-center">
          <button
            type="button"
            onClick={handleDecline}
            className="flex-1 sm:flex-none min-h-[44px] rounded-full border-2 theme-border theme-text bg-transparent px-4 text-sm font-bold hover:theme-bg-subtle"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={handleAccept}
            className="flex-1 sm:flex-none min-h-[44px] theme-accent-fill theme-on-accent rounded-full px-5 text-sm font-bold shadow-sm hover:opacity-90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
