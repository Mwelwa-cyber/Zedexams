import { useCallback, useState } from 'react'
import { sendGuardianConsentRequest } from '../../utils/ageGateService'

/**
 * The guardian hand-off, for a learner who declared an age under 18.
 *
 * The ordering here is the point, and it is the opposite of what a consent
 * screen usually does: THE ACCOUNT ALREADY EXISTS by the time this renders.
 * The learner is signed in and can start reading lessons and past papers
 * immediately, in limited mode, while a guardian is asked. Nothing on this
 * screen blocks practice, nothing here can fail in a way that costs the
 * account, and skipping it leaves a working — if limited — account with a
 * persistent nudge on the dashboard rather than a half-created one.
 *
 * That choice has a consequence worth stating: a child who closes the app on
 * this screen has an account we hold data for and no guardian has approved.
 * Limited mode is what makes that acceptable — the capabilities a guardian
 * would actually object to (an AI to converse with, a public leaderboard, a
 * class full of strangers, spending money) are all off, and only browsing
 * published material is on. See guardianConsentCore.
 *
 * The screen collects an email address and nothing else. The plumbing behind
 * it — hashed single-use token, POST-only approve/decline, a 7-day TTL on the
 * pending record, once-a-day resend — is functions/guardianConsent, unchanged;
 * this is a new entry point into it, not a new mechanism. The WhatsApp option
 * still exists on the dashboard's limited-mode banner for a guardian who is
 * easier to reach that way.
 */

const FIELD =
  'w-full rounded-[10px] border border-[#E3D9CC] bg-white px-3 py-2.5 text-[14px] ' +
  'text-[#1A1F2E] focus:outline-none focus:ring-2 focus:ring-[#C5613F]'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * @param {object} props
 * @param {(result: {guardianEmail: string}) => void} props.onSent  Called once
 *   the request is away.
 * @param {() => void} [props.onSkip]  Continue without asking anyone yet.
 */
export default function GuardianConsentStep({ onSent, onSkip }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async (event) => {
    event.preventDefault()
    setError('')
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      setError("Please enter your parent or guardian's email address.")
      return
    }

    setBusy(true)
    try {
      await sendGuardianConsentRequest({ contact: value, method: 'email' })
      onSent({ guardianEmail: value })
    } catch (err) {
      // A delivery failure must not strand the learner on this screen with an
      // account they cannot reach. Say what happened, and leave the Resend
      // control on the dashboard as the retry — the server's once-a-day
      // cooldown is the thing that would otherwise be worked around by
      // hammering this button.
      const message = err?.code === 'functions/resource-exhausted'
        ? 'We already sent a link today. Please check with your parent or guardian.'
        : "We couldn't send that just now. You can try again from your dashboard."
      setError(message)
    } finally {
      setBusy(false)
    }
  }, [email, onSent])

  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      <div>
        <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">
          Ask a parent or guardian
        </h2>
        <p className="text-[13px] text-[#6B6560] mt-1">
          A parent or guardian needs to approve your account. We&apos;ll send them a link.
        </p>
      </div>

      <div>
        <label
          htmlFor="guardian-email"
          className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5"
        >
          Parent or guardian&apos;s email
        </label>
        <input
          id="guardian-email"
          name="guardian-email"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError('') }}
          autoComplete="off"
          inputMode="email"
          spellCheck={false}
          autoCapitalize="none"
          placeholder="parent@example.com"
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'guardian-email-error' : 'guardian-email-purpose'}
          className={FIELD}
        />
        {/* Purpose limitation, stated where the address is asked for rather
            than in a policy page nobody opens. */}
        <p id="guardian-email-purpose" className="text-[11.5px] text-[#6B6560] mt-1.5 leading-[1.5]">
          We use this address only to ask for approval. We don&apos;t send them anything else.
        </p>
      </div>

      <p className="text-[12.5px] text-[#6B6560] leading-[1.5] rounded-[10px] bg-[#FFF5EC] border border-[rgba(198,123,79,0.25)] px-3 py-2.5">
        You can start practising right away in limited mode. Everything unlocks once they approve.
      </p>

      {error && (
        <p id="guardian-email-error" role="alert" className="text-red-600 text-[11.5px]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-[10px] bg-[#C5613F] text-white font-black py-3 text-[14px] disabled:opacity-60"
      >
        {busy ? 'Sending…' : 'Send approval link'}
      </button>

      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="w-full text-[13px] text-[#6B6560] underline bg-transparent shadow-none py-1"
        >
          I&apos;ll do this later
        </button>
      )}
    </form>
  )
}
