import { useState } from 'react'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth'
import { useAuth } from '../../../contexts/AuthContext'
import { deleteMyAccount, pickReauthMethod } from '../../../utils/accountService'
import { canSubmitDeletion, deletionErrorMessage } from '../../../utils/accountReauth'
import { MIN_PASSWORD_LENGTH, passwordIssue } from '../../../utils/passwordPolicy'
import SettingsDetailShell from '../components/SettingsDetailShell'
import FieldRow from '../components/fields/FieldRow'
import Icon from '../../../shared/components/Icon'
import {
  ShieldCheck,
  Clock,
  Users,
  Lock,
  Mail,
} from '../../../shared/components/icons'

// Real security features only; everything the platform can't honestly do yet
// (2FA, device lists, remote sign-out, backup codes) sits in a muted
// "Coming soon" cluster instead of pretending.
const COMING_SOON = [
  { icon: ShieldCheck, title: 'Two-factor authentication', desc: 'An extra sign-in step with your phone' },
  { icon: Users, title: 'Active devices', desc: 'See and manage where you are signed in' },
  { icon: Clock, title: 'Login history', desc: 'A record of recent sign-ins' },
  { icon: Lock, title: 'Backup codes', desc: 'One-time codes for account recovery' },
]

function friendlyPasswordError(err) {
  switch (err?.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Your current password is incorrect.'
    case 'auth/weak-password':
      return `The new password is too weak — use at least ${MIN_PASSWORD_LENGTH} characters.`
    case 'auth/too-many-requests':
      return 'Too many attempts — please wait a few minutes and try again.'
    case 'auth/requires-recent-login':
      return 'For safety, please sign out and back in, then change your password.'
    default:
      return 'Could not change your password — please try again.'
  }
}

function ChangePasswordCard() {
  const { currentUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // { ok, message }

  const isPasswordAccount = (currentUser?.providerData || []).some(
    (p) => p?.providerId === 'password',
  )

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    // Length AND the whitespace rules, from the one policy every
    // password-setting surface shares (src/utils/passwordPolicy.js).
    const policyIssue = passwordIssue(next)
    if (policyIssue) {
      setStatus({ ok: false, message: policyIssue })
      return
    }
    if (next !== confirm) {
      setStatus({ ok: false, message: 'The new passwords do not match.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, current)
      await reauthenticateWithCredential(currentUser, credential)
      await updatePassword(currentUser, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setStatus({ ok: true, message: 'Password changed ✓' })
    } catch (err) {
      console.error('Password change failed:', err)
      setStatus({ ok: false, message: friendlyPasswordError(err) })
    } finally {
      setBusy(false)
    }
  }

  if (!isPasswordAccount) {
    return (
      <section className="tset-section">
        <h2 className="tset-section__title">Password</h2>
        <p className="tset-section__hint" style={{ margin: 0 }}>
          You sign in with Google, so there's no ZedExams password to change —
          manage your password in your Google account.
        </p>
      </section>
    )
  }

  return (
    <section className="tset-section">
      <h2 className="tset-section__title">Change password</h2>
      <form onSubmit={submit}>
        <div className="tset-grid">
          <FieldRow label="Current password" htmlFor="sec-current" full>
            <input
              id="sec-current"
              className="studio-input"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </FieldRow>
          <FieldRow label="New password" htmlFor="sec-next">
            <input
              id="sec-next"
              className="studio-input"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </FieldRow>
          <FieldRow label="Confirm new password" htmlFor="sec-confirm">
            <input
              id="sec-confirm"
              className="studio-input"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </FieldRow>
        </div>
        {status && (
          <p
            className="tset-help"
            style={{ color: status.ok ? '#10864e' : '#b91c1c', fontWeight: 700, marginTop: 10 }}
          >
            {status.message}
          </p>
        )}
        <div style={{ marginTop: 14 }}>
          <button type="submit" className="tset-btn" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  )
}

export default function SecurityPanel() {
  const { currentUser, resetPassword, logout } = useAuth()
  const [resetSent, setResetSent] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const lastSignIn = currentUser?.metadata?.lastSignInTime
    ? new Date(currentUser.metadata.lastSignInTime).toLocaleString()
    : null

  // Deleting is irreversible, so the server requires a recent re-auth: password
  // accounts confirm with their password, Google accounts via a popup.
  const reauthMethod = pickReauthMethod(currentUser?.providerData)
  const canDelete = canSubmitDeletion({
    method: reauthMethod,
    password: deletePassword,
    confirmed: confirmingDelete,
  })

  const sendReset = async () => {
    try {
      await resetPassword(currentUser.email)
      setResetSent(true)
    } catch (err) {
      console.error('Reset email failed:', err)
    }
  }

  const cancelDelete = () => {
    setConfirmingDelete(false)
    setDeletePassword('')
    setDeleteError('')
  }

  const onDelete = async () => {
    if (!canDelete || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await deleteMyAccount({ password: deletePassword })
      await logout()
    } catch (err) {
      console.error('Account deletion failed:', err)
      setDeleteError(deletionErrorMessage(err))
      setDeleteBusy(false)
    }
  }

  return (
    <SettingsDetailShell rowId="security">
      <ChangePasswordCard />

      <section className="tset-section">
        <h2 className="tset-section__title">This session</h2>
        {lastSignIn && (
          <div className="tset-usage-row">
            <p className="tset-usage-row__label">Last sign-in</p>
            <p className="tset-usage-row__value" style={{ fontSize: 13 }}>{lastSignIn}</p>
          </div>
        )}
        <div className="tset-usage-row">
          <p className="tset-usage-row__label">Signed in as</p>
          <p className="tset-usage-row__value" style={{ fontSize: 13 }}>{currentUser?.email || '—'}</p>
        </div>
        <div className="tset-upload__actions" style={{ marginTop: 10 }}>
          <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={sendReset}>
            <Icon as={Mail} size="sm" aria-hidden="true" />
            {resetSent ? 'Reset email sent ✓' : 'Email me a password reset link'}
          </button>
          <button type="button" className="tset-btn tset-btn--ghost tset-btn--sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </section>

      <section className="tset-group">
        <p className="teacher-dashboard-eyebrow">Coming soon</p>
        <div className="tset-card">
          {COMING_SOON.map((item) => (
            <div key={item.title} className="tset-row tset-row--static">
              <span className="tset-row__badge tset-row__badge--slate">
                <Icon as={item.icon} size="sm" />
              </span>
              <span className="tset-row__text">
                <p className="tset-row__title" style={{ color: 'var(--zt-text-muted)' }}>{item.title}</p>
                <p className="tset-row__desc">{item.desc}</p>
              </span>
              <span className="tset-row__soon">Soon</span>
            </div>
          ))}
        </div>
      </section>

      <section className="tset-section" style={{ borderColor: '#f3cdcd' }}>
        <h2 className="tset-section__title" style={{ color: '#b91c1c' }}>Danger zone</h2>
        <p className="tset-section__hint">
          Deleting your account removes your profile, documents and uploads permanently.
          This cannot be undone.
        </p>
        {deleteError && (
          <p className="tset-help" style={{ color: '#b91c1c', fontWeight: 700 }}>{deleteError}</p>
        )}
        {!confirmingDelete ? (
          <button type="button" className="tset-btn tset-btn--danger" onClick={() => setConfirmingDelete(true)}>
            Delete my account
          </button>
        ) : (
          <div>
            {reauthMethod === 'password' ? (
              <label className="tset-help" style={{ display: 'block', marginBottom: 12 }}>
                Enter your password to confirm
                <input
                  type="password"
                  className="studio-input"
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  disabled={deleteBusy}
                  style={{ marginTop: 6, display: 'block', width: '100%', maxWidth: 320 }}
                />
              </label>
            ) : (
              <p className="tset-help" style={{ marginBottom: 12 }}>
                You'll be asked to confirm with Google before your account is deleted.
              </p>
            )}
            <div className="tset-upload__actions">
              <button type="button" className="tset-btn tset-btn--danger" disabled={deleteBusy || !canDelete} onClick={onDelete}>
                {deleteBusy ? 'Deleting…' : 'Yes, permanently delete'}
              </button>
              <button
                type="button"
                className="tset-btn tset-btn--ghost"
                disabled={deleteBusy}
                onClick={cancelDelete}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

    </SettingsDetailShell>
  )
}
