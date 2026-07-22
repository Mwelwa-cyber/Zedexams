// "Sign in with a passkey" — sits above the Google button on the Login
// surface, same outlined style. The fingerprint glyph is illustrative only:
// passkeys also cover face, PIN, screen lock, and hardware keys, which is
// why the supporting copy never says just "fingerprint".
import { Fingerprint } from '../ui/icons'
import Icon from '../ui/Icon'

export default function PasskeySignInButton({ onClick, loading, disabled }) {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        aria-label="Sign in with a passkey"
        className={
          'w-full h-[46px] flex items-center justify-center gap-2.5 ' +
          'rounded-[10px] border-[1.5px] border-[#2A2A3C] bg-white text-[#1A1F2E] ' +
          'text-[14px] font-semibold font-body ' +
          'transition-all hover:bg-[#F7F7FA] hover:-translate-y-px hover:shadow-sm ' +
          'active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 ' +
          'motion-reduce:transition-none motion-reduce:hover:translate-y-0'
        }
      >
        {loading ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="animate-spin motion-reduce:animate-none" aria-hidden="true">
            <path d="M21 12a9 9 0 11-6.219-8.56" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <Icon as={Fingerprint} size={18} className="text-[var(--accent)]" aria-hidden="true" />
        )}
        <span>{loading ? 'Waiting for your device…' : 'Sign in with a passkey'}</span>
      </button>
      <p className="text-[12px] text-[#888] text-center mt-1.5">
        Use your fingerprint, face, PIN, or device screen lock.
      </p>
    </div>
  )
}
