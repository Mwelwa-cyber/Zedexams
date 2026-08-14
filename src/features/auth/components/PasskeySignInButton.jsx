// "Sign in with a passkey" — sits above the Google button on the Login
// surface, same outlined style. The fingerprint glyph is illustrative only:
// passkeys also cover face, PIN, screen lock, and hardware keys, which is
// why the supporting copy never says just "fingerprint".
import { Fingerprint } from '../../../shared/components/icons'
import Icon from '../../../shared/components/Icon'

export default function PasskeySignInButton({ onClick, loading, disabled }) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-label="Sign in with a passkey"
        aria-busy={loading || undefined}
        className={
          'w-full min-h-[56px] flex items-center justify-center gap-3 ' +
          'rounded-[14px] border border-[#D1D5DB] bg-white text-[#111827] ' +
          'text-[16px] font-semibold font-body ' +
          'transition-all hover:bg-[#FAFAFA] hover:border-[#B9BEC7] ' +
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--accent)]/30 focus-visible:border-[var(--accent)] ' +
          'active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed ' +
          'motion-reduce:transition-none'
        }
      >
        {loading ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="animate-spin motion-reduce:animate-none" aria-hidden="true">
            <path d="M21 12a9 9 0 11-6.219-8.56" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <Icon as={Fingerprint} size={20} className="text-[var(--accent)]" aria-hidden="true" />
        )}
        <span>{loading ? 'Waiting for your device…' : 'Sign in with a passkey'}</span>
      </button>
      <p className="text-[14px] text-[#6E7280] text-center mt-2">
        Use your fingerprint, face, PIN, or device screen lock.
      </p>
    </div>
  )
}
