import { Link } from 'react-router-dom'
import LegalLayout from '../components/LegalLayout'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import AnalyticsConsentToggle from '../../../components/ui/AnalyticsConsentToggle'

/**
 * Public preferences page (audit D2 follow-up).
 *
 * The first-visit cookie banner promises "you can change this any time" —
 * but the only consent control used to live on /profile, which is behind
 * the auth wall. A signed-out visitor (exactly who the banner targets)
 * tapping that link hit the login screen instead of a way to change their
 * mind. This page gives everyone — signed in or not — a real, no-auth
 * path to the same toggle, plus links into the legal docs.
 *
 * Consent is stored in localStorage (utils/analyticsConsent), so the
 * AnalyticsConsentToggle works identically here and on /profile.
 */
export default function CookiePreferences() {
  return (
    <>
      <SeoHelmet
        title="Privacy preferences"
        description="Manage how ZedExams uses privacy-friendly product analytics on this device, and read our Privacy Policy and Terms."
        path="/preferences"
        noIndex
      />
      <LegalLayout title="Privacy preferences">
        <p className="leading-relaxed theme-text-muted">
          Manage how ZedExams uses privacy-friendly product analytics on this
          device. Your choice is saved in this browser, applies straight away,
          and you can change it any time — no account needed.
        </p>

        <AnalyticsConsentToggle />

        <p className="leading-relaxed theme-text-muted">
          For the full detail on what we collect and why, read our{' '}
          <Link to="/privacy" className="underline theme-accent-text font-bold">Privacy Policy</Link>
          {' '}and{' '}
          <Link to="/terms" className="underline theme-accent-text font-bold">Terms &amp; Conditions</Link>.
          We never sell your data or use third-party advertising trackers.
        </p>
      </LegalLayout>
    </>
  )
}
