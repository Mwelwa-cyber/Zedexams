import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { ShieldCheck, Copy, Check, Key, LogOut, AlertTriangle } from '../../../components/ui/icons'
import Logo from '../../../components/ui/Logo'
import Button from '../../../components/ui/Button'
import Icon from '../../../components/ui/Icon'
import OtpInput from '../../../components/auth/OtpInput'
import GoogleSignInButton from '../../../components/auth/GoogleSignInButton'
import { useAuth } from '../../../contexts/AuthContext'
import {
  beginTotpEnrollment,
  completeTotpEnrollment,
  reauthenticateWithGoogle,
  reauthenticateWithPassword,
  primaryProviderId,
  recordMfaEnrollmentEvent,
} from '../../../services/adminMfa'
import { mfaErrorMessage } from '../../../utils/mfaErrors'
import { friendlyAuthMessage } from '../../../utils/friendlyErrors'

/**
 * MfaSetupPage — mandatory authenticator-app (TOTP) enrolment for administrator
 * accounts. Route-gated to admins; renders full-screen (no admin chrome) so a
 * not-yet-enrolled admin gets a single focused task.
 *
 * The enrolment secret lives ONLY in component state (`secretRef` / local
 * state), is never logged or persisted, and is cleared on success/unmount.
 */
export default function MfaSetupPage() {
  const { currentUser, isAdmin, mfaEnrolled, logout } = useAuth()
  const navigate = useNavigate()

  // phase: 'intro' | 'reauth' | 'setup' | 'done'
  const [phase, setPhase] = useState(mfaEnrolled ? 'done' : 'intro')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  const [password, setPassword] = useState('')

  const [qrDataUrl, setQrDataUrl] = useState('')
  const [secretKey, setSecretKey] = useState('')
  // The TOTP secret object required to finish enrolment — memory only.
  const secretRef = useRef(null)
  const submitLockRef = useRef(false)

  const provider = primaryProviderId(currentUser)

  // Wipe any in-memory secret material when leaving the page.
  useEffect(() => () => {
    secretRef.current = null
  }, [])

  // Render the otpauth URI into a scannable QR image whenever a new secret is
  // generated. Failure is non-fatal — the manual key is the fallback.
  useEffect(() => {
    let active = true
    if (!secretRef.current) return
    const uri = secretRef.current.__qrUri
    if (!uri) return
    QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url) })
      .catch(() => { if (active) setQrDataUrl('') })
    return () => { active = false }
  }, [phase])

  async function beginSetup() {
    setError('')
    setBusy(true)
    try {
      recordMfaEnrollmentEvent('started')
      const { secret, qrCodeUrl, secretKey: key } = await beginTotpEnrollment(currentUser)
      // Stash the secret + its QR URI in memory (not state, not logs).
      secret.__qrUri = qrCodeUrl
      secretRef.current = secret
      setSecretKey(key)
      setPhase('setup')
    } catch (err) {
      // A stale session needs a fresh reauth before Firebase will issue an MFA
      // session — switch to the reauth step and let the admin confirm identity.
      if (err?.code === 'auth/requires-recent-login') {
        setPhase('reauth')
      } else if (err?.code === 'auth/unverified-email') {
        setError('Please verify your email address first, then return here to set up MFA.')
      } else {
        setError(mfaErrorMessage(err, { fallback: "We couldn't start MFA setup. Please try again." }))
      }
    } finally {
      setBusy(false)
    }
  }

  async function doGoogleReauth() {
    setError('')
    setBusy(true)
    try {
      await reauthenticateWithGoogle(currentUser)
      await beginSetup()
    } catch (err) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setError('Verification was cancelled. Please try again.')
      } else {
        setError(friendlyAuthMessage(err?.code, { online: navigator.onLine, fallback: "We couldn't verify your identity. Please try again." }))
      }
    } finally {
      setBusy(false)
    }
  }

  async function doPasswordReauth(e) {
    e?.preventDefault?.()
    setError('')
    if (!password) { setError('Please enter your current password.'); return }
    setBusy(true)
    try {
      await reauthenticateWithPassword(currentUser, password)
      setPassword('')
      await beginSetup()
    } catch (err) {
      setError(friendlyAuthMessage(err?.code, { online: navigator.onLine, fallback: "That didn't work. Please check your password and try again." }))
    } finally {
      setBusy(false)
    }
  }

  async function activate(e) {
    e?.preventDefault?.()
    if (submitLockRef.current || busy) return
    if (code.length !== 6) { setError('Enter the 6-digit code from your authenticator app.'); return }
    if (!secretRef.current) { setError('Your setup session expired. Please start again.'); setPhase('intro'); return }
    submitLockRef.current = true
    setBusy(true)
    setError('')
    try {
      await completeTotpEnrollment(currentUser, secretRef.current, code, 'Authenticator app')
      // Enrolment confirmed by Firebase — wipe the secret and audit success.
      // eslint-disable-next-line require-atomic-updates -- unconditional wipe of the secret ref, not a stale read-modify-write
      secretRef.current = null
      setSecretKey('')
      setQrDataUrl('')
      recordMfaEnrollmentEvent('completed')
      setPhase('done')
    } catch (err) {
      recordMfaEnrollmentEvent('failed', err?.code)
      setError(mfaErrorMessage(err))
      setCode('')
    } finally {
      // eslint-disable-next-line require-atomic-updates -- unconditional release of the in-flight lock ref
      submitLockRef.current = false
      setBusy(false)
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(secretKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy failed — please select and copy the key manually.')
    }
  }

  async function handleSignOut() {
    try { await logout() } catch { /* already signed out */ }
    navigate('/login', { replace: true })
  }

  // Defensive: the route guard already blocks non-admins, but never render the
  // enrolment UI for a non-admin even for a frame.
  if (!currentUser || !isAdmin) {
    return (
      <Shell>
        <p className="text-center text-[14px] text-[#555]">This page is for administrators only.</p>
        <Button variant="ghost" size="sm" fullWidth className="mt-4" onClick={handleSignOut}>Sign out</Button>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="flex flex-col items-center text-center mb-5">
        <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#F8EADF]">
          <Icon as={ShieldCheck} size="xl" className="text-[#C5613F]" label="" />
        </span>
        <h1 className="text-[22px] font-bold text-[#1A1F2E]">Secure your administrator account</h1>
        <p className="text-[13.5px] text-[#6B6B76] mt-2 max-w-sm">
          Multi-factor authentication is <strong>mandatory</strong> for administrator access. Set up an
          authenticator app to protect this account before you continue.
        </p>
      </div>

      {error && (
        <p aria-live="assertive" className="flex items-start gap-2 text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm mb-4" style={{ borderColor: 'var(--danger-fg)' }}>
          <Icon as={AlertTriangle} size="sm" className="mt-0.5 shrink-0" label="" />
          <span>{error}</span>
        </p>
      )}

      {phase === 'intro' && (
        <div className="space-y-4">
          <ol className="text-[13px] text-[#4B4B57] space-y-2 bg-[#FBFAF7] rounded-xl p-4 border border-[#EFEAE0]">
            <li>1. Install an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
            <li>2. Scan the QR code we show you, or enter the setup key by hand.</li>
            <li>3. Enter the 6-digit code the app generates to activate.</li>
          </ol>
          <Button variant="primary" size="lg" fullWidth loading={busy} onClick={beginSetup}>
            {busy ? 'Preparing…' : 'Set up authenticator app'}
          </Button>
        </div>
      )}

      {phase === 'reauth' && (
        <div className="space-y-4">
          <p className="text-[13px] text-[#4B4B57] bg-[#FBFAF7] rounded-xl p-4 border border-[#EFEAE0]">
            For your security, please confirm it&apos;s you before setting up MFA.
          </p>
          {provider === 'google.com' ? (
            <GoogleSignInButton onClick={doGoogleReauth} loading={busy} label="Continue with Google to verify" />
          ) : (
            <form onSubmit={doPasswordReauth} className="space-y-3">
              <label htmlFor="reauth-pw" className="block text-[13px] font-medium text-[#1A1F2E]">Current password</label>
              <input
                id="reauth-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full h-[46px] rounded-[10px] border-[1.5px] border-[#2A2A3C] bg-white text-[#1A1F2E] text-sm px-3.5 outline-none focus:border-[var(--accent)] focus:ring-[3px] focus:ring-black/5"
                placeholder="••••••••"
              />
              <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
                {busy ? 'Verifying…' : 'Verify and continue'}
              </Button>
            </form>
          )}
        </div>
      )}

      {phase === 'setup' && (
        <form onSubmit={activate} className="space-y-4">
          <div className="flex flex-col items-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR code — scan with your authenticator app"
                width={200}
                height={200}
                className="rounded-xl border border-[#EFEAE0] bg-white p-2"
              />
            ) : (
              <div className="h-[200px] w-[200px] rounded-xl border border-dashed border-[#D8D2C6] flex items-center justify-center text-[12px] text-[#8A8A93] text-center px-4">
                Use the setup key below to add the account manually.
              </div>
            )}
          </div>

          {/* Manual entry fallback */}
          <div>
            <p className="text-[12px] font-medium text-[#6B6B76] mb-1.5 flex items-center gap-1.5">
              <Icon as={Key} size="xs" label="" /> Can&apos;t scan? Enter this setup key:
            </p>
            <div className="flex items-stretch gap-2">
              <code className="flex-1 select-all break-all rounded-lg bg-[#F5F2EC] border border-[#EFEAE0] px-3 py-2 text-[13px] font-mono tracking-wide text-[#1A1F2E]">
                {secretKey}
              </code>
              <button
                type="button"
                onClick={copyKey}
                aria-label="Copy setup key"
                className="shrink-0 flex items-center gap-1.5 rounded-lg border border-[#EFEAE0] bg-white px-3 text-[12.5px] font-medium text-[#4B4B57] hover:bg-[#FBFAF7] active:scale-95 transition"
              >
                <Icon as={copied ? Check : Copy} size="sm" label="" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="mfa-setup-code" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">
              Enter the 6-digit code from your app
            </label>
            <OtpInput
              id="mfa-setup-code"
              value={code}
              onChange={setCode}
              disabled={busy}
              invalid={!!error}
              autoFocus
              describedBy={error ? undefined : 'mfa-setup-help'}
            />
            <p id="mfa-setup-help" className="text-[12px] text-[#8A8A93] mt-1.5">
              The code changes every 30 seconds.
            </p>
          </div>

          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={code.length !== 6}>
            {busy ? 'Activating…' : 'Activate MFA'}
          </Button>
        </form>
      )}

      {phase === 'done' && (
        <div className="space-y-4">
          <div className="flex flex-col items-center text-center bg-success-subtle border rounded-2xl p-5" style={{ borderColor: 'var(--success-fg)' }}>
            <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
              <Icon as={Check} size="lg" className="text-success" label="Enabled" />
            </span>
            <p className="text-success font-semibold">Multi-factor authentication is on</p>
            <p className="text-success text-body-sm mt-1 opacity-80">
              Your administrator account is now protected with your authenticator app.
            </p>
          </div>
          <div className="text-[13px] text-[#4B4B57] bg-[#FBFAF7] rounded-xl p-4 border border-[#EFEAE0] space-y-1.5">
            <p className="font-medium text-[#1A1F2E]">Keep access safe:</p>
            <p>• You&apos;ll enter a code from your authenticator app each time you sign in.</p>
            <p>• If you lose your device, a super admin can reset your MFA so you can re-enrol.</p>
            <p>• For your security, please sign in again now to finish.</p>
          </div>
          <Button variant="primary" size="lg" fullWidth onClick={handleSignOut}>
            Sign in again to continue
          </Button>
        </div>
      )}

      {phase !== 'done' && (
        <div className="mt-6 pt-4 border-t border-[#EFEAE0] text-center">
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[#8A8A93] hover:text-[#1A1F2E] transition bg-transparent shadow-none p-0 min-h-0"
          >
            <Icon as={LogOut} size="xs" label="" /> Sign out
          </button>
        </div>
      )}
    </Shell>
  )
}

// Full-screen branded card, matching the auth visual system.
function Shell({ children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative overflow-y-auto"
      style={{ backgroundColor: 'var(--zt-surface)', '--accent': '#C5613F', '--accent-bg': '#F8EADF', '--accent-fg': '#83372C' }}
    >
      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[460px] px-5 sm:px-8 pt-8 pb-7 animate-scale-in relative z-10">
        <div className="flex flex-col items-center mb-5 gap-1">
          <Logo variant="full" size="md" />
        </div>
        {children}
      </div>
    </div>
  )
}
