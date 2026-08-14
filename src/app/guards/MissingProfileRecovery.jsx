// Recovery screen for a signed-in user whose Firestore profile could not be
// read ('unreadable' — usually a transient network failure) or is genuinely
// absent ('missing'). Rendered IN PLACE by RootRedirect and ProtectedRoute —
// never via a redirect — so the URL the user was on survives the hiccup: once
// Repair (or the background onSnapshot retry) restores the profile, the guard
// re-renders and they continue exactly where they were. The Firebase session
// itself is never touched here except by the explicit Sign Out button.
import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'

export default function MissingProfileRecovery() {
  const { currentUser, profileIssue, ensureUserProfile, logout } = useAuth()
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')

  async function handleRepair() {
    setWorking(true)
    setMessage('')
    try {
      const profile = await ensureUserProfile(currentUser)
      if (!profile) {
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
      </div>
    </div>
  )
}
