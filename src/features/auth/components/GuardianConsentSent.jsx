import { useCallback, useState } from 'react'
import { sendGuardianConsentRequest } from '../../../utils/ageGateService'
import Button from '../../../shared/components/Button'
import { AVAILABLE_NOW, lockedUntilApproved } from '../lib/guardianWaitCapabilities'

/**
 * The minor's waiting screen — and the screen a wrong number gets caught on.
 *
 * WAITING IS NOT BLOCKING. The account exists, the child goes straight into
 * lessons and past papers, and the message is out. Everything on this screen
 * is built around that being TRUE and being BELIEVED:
 *
 *   • "Message sent", not "waiting for approval". A child who reads this as
 *     "you may not start yet" closes the app and does not come back, which is
 *     the outcome limited mode exists to avoid.
 *
 *   • The two lists. What works now, and what switches on when their grown-up
 *     says yes. Naming both stops the wait reading as a punishment and gives
 *     the child a concrete reason to go and nudge the adult — and the lists
 *     are DERIVED from the capability sets the server enforces, so they
 *     cannot quietly start lying (see guardianWaitCapabilities).
 *
 *   • Send again AND use a different contact, both here. This is where a
 *     mistyped digit is discovered: the child asked, nothing happened, and
 *     the only person who can tell is them. A screen that offers Resend but
 *     no way to change the number can only send the same message to the same
 *     wrong place.
 *
 * Resend is the same server call as the dashboard banner's, with the same
 * backoff ladder, so tapping it here is not a way around the pacing — and
 * when it is refused, the refusal says when rather than just "no".
 */
export default function GuardianConsentSent({ guardianContact, guardianEmail, channel, onContinue, onChangeContact }) {
  // `guardianEmail` is the pre-WhatsApp prop name. Kept so a session that was
  // mid-signup across the deploy still shows who was messaged rather than a
  // blank where the address should be.
  const contact = guardianContact || guardianEmail
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = lockedUntilApproved()

  const resend = useCallback(async () => {
    setNote(''); setError(''); setBusy(true)
    try {
      const result = await sendGuardianConsentRequest({ contact, channel })
      if (result?.waLink) {
        window.open(result.waLink, '_blank', 'noopener')
        setNote('WhatsApp is open — press send to message your grown-up.')
      } else {
        setNote('Sent again. Ask them to check their messages, including spam.')
      }
    } catch (err) {
      setError(err?.message || "We couldn't send that just now. You can try again from your dashboard.")
    } finally { setBusy(false) }
  }, [contact, channel])

  return (
    <div className="space-y-3.5">
      <div className="text-center">
        <div
          className="w-16 h-16 rounded-full bg-[#EAF7F0] text-[#1FAA6C] text-[28px] grid place-items-center mx-auto mb-2"
          aria-hidden="true"
        >
          ✓
        </div>
        <h2 className="font-display font-black text-[19px] text-[#1A1F2E]">Message sent</h2>
        <p className="text-[13px] text-[#6B6560] mt-1 leading-[1.55]">
          We&apos;ve asked your grown-up{contact ? <> at <strong className="text-[#1A1F2E] break-all">{contact}</strong></> : null}.
          Start learning now — we&apos;ll tell you the moment they say yes.
        </p>
      </div>

      <div className="rounded-[12px] border border-[#E3D9CC] bg-white px-3.5 py-3">
        <span className="inline-block rounded-full bg-[#FFF5EC] border border-[#F2DCB4] text-[#9A6412] text-[10.5px] font-black px-2.5 py-0.5 mb-2">
          WAITING
        </span>

        <p className="text-[13px] font-black text-[#1A1F2E] mb-1.5">You can use these now</p>
        <ul className="list-none p-0 m-0 space-y-1">
          {AVAILABLE_NOW.map((item) => (
            <li key={item} className="flex gap-2 text-[12.5px] text-[#4B5270]">
              <span aria-hidden="true" className="text-[#1FAA6C] font-black">✓</span>
              {item}
            </li>
          ))}
        </ul>

        <p className="text-[13px] font-black text-[#1A1F2E] mt-3 mb-1.5">
          These switch on after they say yes
        </p>
        <ul className="list-none p-0 m-0 space-y-1">
          {locked.map((item) => (
            <li key={item} className="flex gap-2 text-[12.5px] text-[#4B5270]">
              <span aria-hidden="true" className="text-[#B9BFD8] font-black">○</span>
              {item}
            </li>
          ))}
        </ul>
      </div>

      {note && <p role="status" className="text-[11.5px] text-[#1E9E6B] text-center">{note}</p>}
      {error && <p role="alert" className="text-[11.5px] text-red-600 text-center">{error}</p>}

      <Button type="button" variant="primary" size="lg" fullWidth onClick={onContinue}>
        Start learning →
      </Button>

      <p className="text-[12.5px] text-center text-[#6B6560]">
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="text-[#C5613F] font-bold underline bg-transparent shadow-none p-0 disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send it again'}
        </button>
        {onChangeContact && (
          <>
            <span aria-hidden="true" className="mx-2">·</span>
            <button
              type="button"
              onClick={onChangeContact}
              className="text-[#C5613F] font-bold underline bg-transparent shadow-none p-0"
            >
              Use a different {channel === 'email' ? 'address' : 'number'}
            </button>
          </>
        )}
      </p>
    </div>
  )
}
