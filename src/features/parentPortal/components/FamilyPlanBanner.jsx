/**
 * FamilyPlanBanner — the one plan strip in the family app.
 *
 * It replaces the app-level `SubscriptionStatusBanner` on every /family
 * route (see `reminderVisibility.js`, which now suppresses that strip
 * here), and it replaces it for three reasons rather than one:
 *
 *   • ONE, EVERYWHERE. The app-level strip renders outside the parent
 *     shell, above the router, full-bleed. At the ≥1000px breakpoint the
 *     family navigation is a FIXED left sidebar at z-index 40, which is
 *     painted straight over the left of that strip — which is why the
 *     text read "free p|lan", clipped at the sidebar's edge. This one
 *     renders inside `.lhx-page`, the same column as the content, so the
 *     sidebar cannot reach it and it is offset exactly like everything
 *     else on the page. It also appears on /family/account, which the
 *     app-level strip reached inconsistently.
 *
 *   • THE RIGHT PRODUCT. See familyPlanBanner.js — the old copy named a
 *     teacher tier and described the guardian's own subscription rather
 *     than the child's.
 *
 *   • THE ACTION SURVIVES A PHONE. The old strip put its sentence and
 *     its "Upgrade →" in one truncating row, so at 390px the sentence
 *     ate the link and the ✕ was the only control left. Here the CTA is
 *     a separate flex item that never shrinks, and the sentence swaps to
 *     a shorter one below 480px instead of being cut off.
 *
 * Dismissal is per browser session, matching the strip it replaces: a
 * guardian who has decided not to buy today should not be asked again on
 * every tab change, and a decision that outlived the session would mean
 * the offer disappears for good after one ✕.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { familyPlanBannerCopy, resolveFamilyPlanBanner } from '../lib/familyPlanBanner'

const SESSION_DISMISS_KEY = 'zedexams.familyPlanBanner.dismissed'

export default function FamilyPlanBanner() {
  const { loading, error, children } = useGuardianChildren()
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(SESSION_DISMISS_KEY) === '1' } catch { return false }
  })

  const verdict = resolveFamilyPlanBanner({ loading, error, children })
  if (!verdict.show || dismissed) return null

  const copy = familyPlanBannerCopy(verdict.unpaid)

  function dismiss() {
    try { sessionStorage.setItem(SESSION_DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="pax-planbar">
      <Link className="pax-planbar-main" to={copy.to}>
        <span className="pax-planbar-tag">
          <span aria-hidden="true">✨</span> {copy.label}
        </span>
        {/* Two strings, one shown per width — see the docblock. The
            unused one is `display: none`, so it leaves the accessibility
            tree with the layout and a screen reader announces exactly
            one sentence. Doing this in CSS rather than from a width
            hook keeps the swap on the first paint: a JS breakpoint
            renders the desktop sentence first and reflows the banner
            after mount, which on a phone is a visible jump in the chrome
            above the greeting. */}
        <span className="pax-planbar-msg pax-planbar-msg-full">{copy.full}</span>
        <span className="pax-planbar-msg pax-planbar-msg-short">{copy.short}</span>
        <span className="pax-planbar-cta">{copy.cta} →</span>
      </Link>
      <button
        type="button"
        className="pax-planbar-x"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        ✕
      </button>
    </div>
  )
}
