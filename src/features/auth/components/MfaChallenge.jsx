import { useRef, useState } from 'react'
import { ShieldCheck } from '../../../shared/components/icons'
import Logo from '../../../shared/components/Logo'
import Button from '../../../shared/components/Button'
import Icon from '../../../shared/components/Icon'
import OtpInput from './OtpInput'
import { findTotpHint, completeTotpSignIn } from '../../../services/adminMfa'
import { mfaErrorMessage } from '../../../utils/mfaErrors'

/**
 * MfaChallenge — the second-factor step of sign-in.
 *
 * Rendered by Login when the first factor throws auth/multi-factor-auth-required.
 * It takes the Firebase multi-factor RESOLVER (held in Login's component state
 * only — never serialised), asks for the 6-digit authenticator code, resolves
 * the sign-in, and hands the UserCredential back so the normal role/route flow
 * continues.
 *
 * If the resolver was lost (e.g. a page refresh cleared component state), we
 * show a clear "session ended" message and route the user back to normal
 * sign-in via onCancel — never a dead end.
 */
export default function MfaChallenge({ resolver, onSuccess, onCancel }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Synchronous re-entry guard: blocks a second submit fired in the same tick
  // (double-click / auto-submit + click) before React state updates.
  const submitLockRef = useRef(false)

  const hint = resolver ? findTotpHint(resolver) : null

  // Resolver lost (refresh) or no TOTP factor on the account.
  if (!resolver || !hint) {
    return (
      <ChallengeShell>
        <p aria-live="polite" className="text-[13px] text-center rounded-xl px-4 py-3 mb-4 bg-amber-50 text-amber-800 border border-amber-200">
          Your sign-in session ended. Please sign in again to continue.
        </p>
        <Button variant="primary" size="lg" fullWidth onClick={onCancel}>
          Back to sign in
        </Button>
      </ChallengeShell>
    )
  }

  async function submit(e) {
    e?.preventDefault?.()
    if (submitLockRef.current || submitting) return
    if (code.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    submitLockRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const cred = await completeTotpSignIn(resolver, hint, code)
      // Success — hand back to the caller for role/route resolution.
      onSuccess(cred)
    } catch (err) {
      setError(mfaErrorMessage(err))
      setCode('')
    } finally {
      // eslint-disable-next-line require-atomic-updates -- unconditional release of the in-flight lock ref
      submitLockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <ChallengeShell>
      <div className="flex flex-col items-center text-center mb-5">
        <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F8EADF]">
          <Icon as={ShieldCheck} size="lg" className="text-[#C5613F]" label="" />
        </span>
        <h2 className="text-[20px] font-bold text-[#1A1F2E]">Two-step verification</h2>
        <p className="text-[13px] text-[#6E7280] mt-1 max-w-xs">
          Enter the 6-digit code from your authenticator app to finish signing in.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <label htmlFor="mfa-challenge-code" className="sr-only">Six-digit verification code</label>
        <OtpInput
          id="mfa-challenge-code"
          value={code}
          onChange={setCode}
          onComplete={() => submit()}
          disabled={submitting}
          invalid={!!error}
          autoFocus
          describedBy={error ? 'mfa-challenge-error' : undefined}
        />

        {error && (
          <p id="mfa-challenge-error" aria-live="assertive" className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm" style={{ borderColor: 'var(--danger-fg)' }}>
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" fullWidth loading={submitting} disabled={code.length !== 6}>
          {submitting ? 'Verifying…' : 'Verify'}
        </Button>
        <Button type="button" variant="ghost" size="sm" fullWidth onClick={onCancel} disabled={submitting}>
          Cancel and sign out
        </Button>
      </form>
    </ChallengeShell>
  )
}

// Shared branded card chrome so the challenge matches the Login visual system.
function ChallengeShell({ children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-6 relative overflow-y-auto"
      style={{ backgroundColor: 'var(--zt-surface)', '--accent': '#B44F2D', '--accent-bg': '#F8EADF', '--accent-fg': '#83372C' }}
    >
      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[calc(100vw-2rem)] sm:max-w-[440px] px-5 sm:px-8 pt-9 pb-8 animate-scale-in relative z-10">
        <div className="flex flex-col items-center mb-5 gap-1">
          <Logo variant="full" size="md" />
        </div>
        {children}
      </div>
    </div>
  )
}
