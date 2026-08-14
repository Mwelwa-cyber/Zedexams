import { useCallback, useState } from 'react'
import { sendGuardianConsentRequest } from '../../../utils/ageGateService'
import Button from '../../../shared/components/Button'

/**
 * The minor's success screen.
 *
 * It says three things, and each is there because leaving it out produces a
 * specific misunderstanding:
 *
 *   • "You're in!" — the account EXISTS. A child who reads this screen as
 *     "waiting for approval before you can start" closes the app and never
 *     comes back, which is the outcome limited mode was designed to avoid.
 *   • The limited-mode badge — so the first locked feature is not a surprise
 *     that reads as a bug.
 *   • Who we emailed — so a mistyped address is caught here, by the person
 *     who typed it, rather than a week later when nobody has approved.
 *
 * Resend is the same server call as the dashboard banner's, with the same
 * once-a-day cooldown, so tapping it here is not a way around the limit.
 */
export default function GuardianConsentSent({ guardianEmail, onContinue }) {
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const resend = useCallback(async () => {
    setNote(''); setError(''); setBusy(true)
    try {
      await sendGuardianConsentRequest({ contact: guardianEmail, method: 'email' })
      setNote('Sent again. Ask them to check their inbox and spam folder.')
    } catch (err) {
      setError(err?.code === 'functions/resource-exhausted'
        ? 'We already sent a link today. Please try again tomorrow.'
        : "We couldn't send that just now. You can try again from your dashboard.")
    } finally { setBusy(false) }
  }, [guardianEmail])

  return (
    <div className="space-y-3.5 text-center">
      <div className="text-[40px] leading-none" aria-hidden="true">🎉</div>
      <h2 className="font-display font-black text-[20px] text-[#1A1F2E]">You&apos;re in!</h2>

      <p className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF5EC] border border-[rgba(198,123,79,0.3)] px-3 py-1.5 text-[12px] font-bold text-[#96552F]">
        <span aria-hidden="true">🔒</span>
        Limited mode until your guardian approves
      </p>

      <p className="text-[13px] text-[#6B6560] leading-[1.55]">
        We&apos;ve emailed an approval link to <strong className="text-[#1A1F2E]">{guardianEmail}</strong>.
        You can start practising right away — everything unlocks once they approve.
      </p>

      {note && <p role="status" className="text-[11.5px] text-[#1E9E6B]">{note}</p>}
      {error && <p role="alert" className="text-[11.5px] text-red-600">{error}</p>}

      <Button type="button" variant="primary" size="lg" fullWidth onClick={onContinue}>
        Start practising
      </Button>

      <button
        type="button"
        onClick={resend}
        disabled={busy}
        className="w-full text-[13px] text-[#6B6560] underline bg-transparent shadow-none py-1 disabled:opacity-60"
      >
        {busy ? 'Sending…' : "Didn't arrive? Resend the link"}
      </button>
    </div>
  )
}
