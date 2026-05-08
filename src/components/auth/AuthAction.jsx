import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from 'firebase/auth'
import { auth } from '../../firebase/config'
import Logo from '../ui/Logo'
import Button from '../ui/Button'
import SeoHelmet from '../seo/SeoHelmet'

const INPUT_CLASS =
  'w-full h-[46px] rounded-[10px] border-[1.5px] border-[#2A2A3C] bg-white ' +
  'text-[#1A1F2E] text-sm font-body px-3.5 outline-none transition-colors ' +
  'placeholder:text-[#B0AEBB] focus:border-[var(--accent)] ' +
  'focus:ring-[3px] focus:ring-black/5'

const FRIENDLY = {
  'auth/expired-action-code':  'This link has expired. Please request a new one.',
  'auth/invalid-action-code':  'This link is invalid or has already been used.',
  'auth/user-disabled':        'This account has been disabled. Please contact support.',
  'auth/user-not-found':       'We could not find an account for this link.',
  'auth/weak-password':        'That password is too weak. Use at least 6 characters.',
}

function friendlyError(err, fallback) {
  return FRIENDLY[err?.code] ?? fallback
}

export default function AuthAction() {
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const mode     = params.get('mode')
  const oobCode  = params.get('oobCode')
  // continueUrl + lang are passed through by Firebase; we don't need them here.

  const [status, setStatus]     = useState('loading') // loading | form | success | error
  const [error, setError]       = useState('')
  const [accountEmail, setAccountEmail] = useState('')

  // Password-reset form state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting]   = useState(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (!mode || !oobCode) {
        setError('This link is missing information. Please request a new email.')
        setStatus('error')
        return
      }

      try {
        if (mode === 'resetPassword') {
          const email = await verifyPasswordResetCode(auth, oobCode)
          if (cancelled) return
          setAccountEmail(email)
          setStatus('form')
          return
        }

        if (mode === 'verifyEmail') {
          const info = await checkActionCode(auth, oobCode)
          await applyActionCode(auth, oobCode)
          if (cancelled) return
          setAccountEmail(info?.data?.email ?? '')
          setStatus('success')
          return
        }

        if (mode === 'recoverEmail') {
          const info = await checkActionCode(auth, oobCode)
          await applyActionCode(auth, oobCode)
          if (cancelled) return
          setAccountEmail(info?.data?.email ?? '')
          setStatus('success')
          return
        }

        setError('Unsupported action. Please request a new email.')
        setStatus('error')
      } catch (err) {
        if (cancelled) return
        setError(friendlyError(err, 'This link could not be verified. Please request a new email.'))
        setStatus('error')
      }
    }

    run()
    return () => { cancelled = true }
  }, [mode, oobCode])

  async function handlePasswordReset(e) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      await confirmPasswordReset(auth, oobCode, newPassword)
      setStatus('success')
    } catch (err) {
      setError(friendlyError(err, 'We could not reset your password. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{
        backgroundColor: '#FDF6EC',
        '--accent': '#EA580C',
        '--accent-bg': '#FFEDD5',
        '--accent-fg': '#9A3412',
      }}
    >
      <SeoHelmet
        title="Account action"
        description="Confirming your email or password reset link."
        path="/auth/action"
        noIndex
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
        <div className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }} />
      </div>

      <div className="bg-white rounded-[18px] shadow-xl w-full max-w-[400px] sm:max-w-[520px] px-8 pt-9 pb-8 animate-scale-in relative z-10">
        <div className="flex flex-col items-center mb-2.5 gap-1">
          <Logo variant="full" size="md" />
          <p className="text-[12px] text-[#999] font-body">Practise smart.</p>
        </div>

        {status === 'loading' && (
          <div className="text-center py-10">
            <h2 className="text-[20px] font-bold text-[#1A1F2E]">Verifying your link…</h2>
            <p className="text-[13px] text-[#888] mt-2">One moment while ZedExams checks this email link.</p>
          </div>
        )}

        {status === 'form' && mode === 'resetPassword' && (
          <div className="animate-slide-up">
            <div className="text-center mb-6">
              <h2 className="text-[20px] font-bold text-[#1A1F2E]">Set a new password</h2>
              <p className="text-[13px] text-[#888] mt-1">
                {accountEmail ? <>For <span className="font-semibold text-[#1A1F2E]">{accountEmail}</span></> : 'Enter your new password below.'}
              </p>
            </div>

            <form onSubmit={handlePasswordReset} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">
                  New password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="Re-type your new password"
                  className={INPUT_CLASS}
                />
              </div>

              {error && (
                <p aria-live="polite" className="text-danger bg-danger-subtle border rounded-xl px-4 py-3 text-body-sm" style={{ borderColor: 'var(--danger-fg)' }}>
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={submitting}
              >
                {submitting ? 'Saving…' : 'Save new password'}
              </Button>
            </form>
          </div>
        )}

        {status === 'success' && (
          <div className="text-center py-6 animate-slide-up">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
              <span aria-hidden="true" className="text-success text-2xl">✓</span>
            </div>
            {mode === 'resetPassword' && (
              <>
                <h2 className="text-[20px] font-bold text-[#1A1F2E]">Password updated</h2>
                <p className="text-[13px] text-[#888] mt-2">
                  You can now sign in to ZedExams with your new password.
                </p>
              </>
            )}
            {mode === 'verifyEmail' && (
              <>
                <h2 className="text-[20px] font-bold text-[#1A1F2E]">Email verified</h2>
                <p className="text-[13px] text-[#888] mt-2">
                  Thanks for confirming {accountEmail || 'your email address'}. You can now sign in to ZedExams.
                </p>
              </>
            )}
            {mode === 'recoverEmail' && (
              <>
                <h2 className="text-[20px] font-bold text-[#1A1F2E]">Email change reverted</h2>
                <p className="text-[13px] text-[#888] mt-2">
                  Your ZedExams sign-in email has been restored to {accountEmail || 'the previous address'}.
                </p>
              </>
            )}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="mt-6"
              onClick={() => navigate('/login', { replace: true })}
            >
              Continue to sign in
            </Button>
          </div>
        )}

        {status === 'error' && (
          <div className="text-center py-6 animate-slide-up">
            <h2 className="text-[20px] font-bold text-[#1A1F2E]">Something went wrong</h2>
            <p className="text-[13px] text-[#888] mt-2">{error}</p>
            <p className="text-[12.5px] text-[#888] mt-4">
              <Link to="/login" className="text-[var(--accent)] font-semibold hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
