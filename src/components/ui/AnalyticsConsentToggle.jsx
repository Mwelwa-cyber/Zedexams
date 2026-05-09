/**
 * AnalyticsConsentToggle — change the cookie / analytics consent
 * decision after the first-visit banner (audit D2).
 *
 * Lives on /profile. Reflects the localStorage decision in real
 * time and re-emits the change event so the analytics bootstrap
 * flips on/off without a reload.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  CONSENT_ACCEPTED,
  CONSENT_DECLINED,
  getConsent,
  onConsentChange,
  setConsent,
} from '../../utils/analyticsConsent'

export default function AnalyticsConsentToggle() {
  const [decision, setDecision] = useState(getConsent())

  useEffect(() => {
    return onConsentChange(setDecision)
  }, [])

  const handleAccept = useCallback(() => setConsent(CONSENT_ACCEPTED), [])
  const handleDecline = useCallback(() => setConsent(CONSENT_DECLINED), [])

  const accepted = decision === CONSENT_ACCEPTED
  const declined = decision === CONSENT_DECLINED

  return (
    <section className="theme-card border theme-border rounded-radius-md p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="theme-text font-black text-sm flex items-center gap-2">
            <span aria-hidden="true">📊</span>
            Product analytics
          </p>
          <p className="theme-text-muted text-xs mt-1 max-w-prose leading-snug">
            We use anonymous analytics to see which lessons help most.
            We never share your data with anyone and you can change this
            any time.
          </p>
          <p className={`text-[11px] font-bold mt-2 ${
            accepted ? 'text-emerald-700' : declined ? 'text-rose-700' : 'theme-text-muted'
          }`}>
            {accepted && '✓ Currently enabled'}
            {declined && '✕ Currently disabled'}
            {!accepted && !declined && '⏳ No decision yet'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleAccept}
          disabled={accepted}
          className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
            accepted
              ? 'theme-bg-subtle theme-text-muted cursor-default'
              : 'theme-accent-fill theme-on-accent hover:opacity-90'
          }`}
        >
          {accepted ? 'Enabled' : 'Enable'}
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={declined}
          className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors ${
            declined
              ? 'theme-border theme-text-muted cursor-default'
              : 'theme-border theme-text-muted hover:theme-text hover:theme-bg-subtle'
          }`}
        >
          {declined ? 'Disabled' : 'Disable'}
        </button>
      </div>
    </section>
  )
}
