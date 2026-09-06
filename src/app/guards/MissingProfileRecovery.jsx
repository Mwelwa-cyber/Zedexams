// Recovery screen for a signed-in user whose Firestore profile could not be
// read ('unreadable' — usually a transient network failure) or is genuinely
// absent ('missing'). Rendered IN PLACE by RootRedirect and ProtectedRoute —
// never via a redirect — so the URL the user was on survives the hiccup: once
// Repair (or the background onSnapshot retry) restores the profile, the guard
// re-renders and they continue exactly where they were. The Firebase session
// itself is never touched here except by the explicit Sign Out button.
import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { attestationDegraded } from '../../firebase/appCheckResilient'

const SUPPORT_EMAIL = 'support@zedexams.com'
const SUPPORT_WHATSAPP_HREF = 'https://wa.me/260977740465'

// After this many failed repairs, stop suggesting the same button on its own
// and surface a human channel too. A device that genuinely can't attest (see
// attestationDegraded()) fails this identically every time — "keep tapping
// Repair" is not a plan once that's been shown to be true.
const SUPPORT_FALLBACK_AFTER_ATTEMPTS = 2

export default function MissingProfileRecovery() {
  const { currentUser, profileIssue, ensureUserProfile, logout } = useAuth()
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [attempts, setAttempts] = useState(0)
  // attestationDegraded() reads App Check's own live state (see
  // appCheckResilient.js) — true when this device hasn't produced a real
  // token recently. Checked on arrival AND after every failed repair,
  // because the single most common cause of a repair that never succeeds is
  // a device/network that cannot complete the App Check security check at
  // all (blocked reCAPTCHA domains, an ad-blocker/VPN, a misconfigured key)
  // — in which case the failure is not about this account and clicking the
  // same button again will not change the outcome.
  const [likelyAttestation, setLikelyAttestation] = useState(false)

  useEffect(() => {
    setLikelyAttestation(attestationDegraded())
  }, [])

  async function handleRepair() {
    setWorking(true)
    setMessage('')
    try {
      const profile = await ensureUserProfile(currentUser)
      if (!profile) {
        setAttempts((n) => n + 1)
        setLikelyAttestation(attestationDegraded())
        setMessage('We could not restore this account automatically yet. Please sign out and try again, or contact support.')
      }
    } finally {
      setWorking(false)
    }
  }

  async function handleSignOut() {
    setWorking(true)
    try {
      await logout()
    } finally {
      setWorking(false)
    }
  }

  const description = profileIssue === 'unreadable'
    ? 'We signed you in, but ZedExams could not read your account profile yet.'
    : 'We signed you in, but your ZedExams profile is missing.'

  const showSupportFallback = attempts >= SUPPORT_FALLBACK_AFTER_ATTEMPTS

  return (
    <div className="min-h-screen theme-bg flex items-center justify-center p-4">
      <div className="theme-card border theme-border rounded-3xl shadow-xl w-full max-w-md p-8 text-center">
        <div className="text-4xl mb-3">🛠️</div>
        <h1 className="text-display-md theme-text mb-2">Account Repair Needed</h1>
        <p className="theme-text-muted text-body-sm mb-2">{description}</p>
        <p className="theme-text-muted text-body-sm mb-6">
          Signed in as <span className="font-black theme-text">{currentUser?.email || 'your account'}</span>.
        </p>

        {message && (
          <p className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm mb-4" style={{ borderColor: 'var(--danger-fg)' }}>
            {message}
          </p>
        )}

        {likelyAttestation && (
          <p role="status" className="theme-text-muted text-body-sm mb-4 text-left bg-black/5 rounded-xl px-4 py-3">
            This usually means your browser or network blocked a background
            security check. Try mobile data instead of Wi-Fi, turn off any
            ad-blocker or VPN, or try a different browser — then tap Repair
            again.
          </p>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleRepair}
            disabled={working}
            className="w-full rounded-xl bg-green-600 px-4 py-3 text-white font-black transition hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {working ? 'Repairing account…' : 'Repair My Account'}
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={working}
            className="w-full rounded-xl border theme-border px-4 py-3 font-black theme-text bg-transparent hover:bg-black/5 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Sign Out
          </button>
        </div>

        {showSupportFallback && (
          <div className="mt-6 pt-6 border-t theme-border text-body-sm theme-text-muted text-left">
            <p className="mb-2">Still stuck after a few tries? Reach us directly:</p>
            <div className="flex flex-col gap-1">
              <a className="font-bold underline theme-text" href={`mailto:${SUPPORT_EMAIL}`}>
                Email {SUPPORT_EMAIL}
              </a>
              <a
                className="font-bold underline theme-text"
                href={SUPPORT_WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp support
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
