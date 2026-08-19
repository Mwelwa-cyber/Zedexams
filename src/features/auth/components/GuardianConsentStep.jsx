import { useCallback, useMemo, useState } from 'react'
import {
  previewGuardianConsentRequest,
  sendGuardianConsentRequest,
  startSameDeviceConsent,
} from '../../../utils/ageGateService'
import {
  CONTACT_CHANNEL,
  DEFAULT_CONTACT_CHANNEL,
  normalizeGuardianContact,
} from '../../../utils/guardianConsent'
import GuardianContactConfirm from './GuardianContactConfirm'
import GuardianHandoffStep from './GuardianHandoffStep'
import GuardianNoContactHelp from './GuardianNoContactHelp'

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
 * would actually object to (an AI to converse with, a public leaderboard,
 * spending money) are all off, and only browsing published material is on.
 * See guardianConsentCore.
 *
 * ── WhatsApp first, email second ─────────────────────────────────────────
 *
 * This step used to collect an email address and nothing else, and that was
 * the single biggest hole in the funnel: plenty of Zambian guardians have no
 * inbox they check, and nearly all have WhatsApp — the channel this product
 * already reaches them on for MTN and Airtel payments. The default is
 * therefore whichever channel we can actually deliver on
 * (DEFAULT_CONTACT_CHANNEL), not the tidier one.
 *
 * ── Four screens, and none of them is a wall ─────────────────────────────
 *
 *   ask       channel + contact, with the grown-up-is-here shortcut
 *   confirm   the contact echoed back, and the REAL outbound message
 *   handoff   the adult in the room decides on this phone
 *   help      no guardian contact at all → a person, never a locked state
 *
 * The plumbing behind them — hashed single-use token, POST-only
 * approve/decline, a 7-day TTL, the send backoff ladder — is
 * functions/guardianConsent and functions/shared/consent. Every rule this
 * screen appears to enforce is enforced there; what it does here is explain
 * the rule before the child hits it.
 */

const FIELD =
  'w-full rounded-[10px] border border-[#E3D9CC] bg-white px-3 py-2.5 text-[14px] ' +
  'text-[#1A1F2E] focus:outline-none focus:ring-2 focus:ring-[#C5613F]'

const STEP = { ASK: 'ask', CONFIRM: 'confirm', HANDOFF: 'handoff', HELP: 'help' }

const CHANNELS = [
  { value: CONTACT_CHANNEL.WHATSAPP, label: '💬 WhatsApp' },
  { value: CONTACT_CHANNEL.EMAIL, label: '✉️ Email' },
]

/**
 * A callable failure, in words a child can act on.
 *
 * The server's own message is preferred wherever it sent one — it is the side
 * that knows why (their own contact, a contact that already learns here, how
 * long until the next message may go). Only a transport failure falls back to
 * generic copy, and even that points at the dashboard rather than at nothing.
 */
function failureMessage(err) {
  const code = err?.code || ''
  if (code === 'functions/invalid-argument' || code === 'functions/resource-exhausted') {
    return err?.message || 'We could not send that just now.'
  }
  if (code === 'functions/failed-precondition') {
    return err?.message || 'We could not send that just now.'
  }
  return "We couldn't send that just now. You can try again from your dashboard."
}

/**
 * @param {object} props
 * @param {(result: {guardianContact: string, channel: string}) => void} props.onSent
 * @param {() => void} [props.onSkip]     Continue without asking anyone yet.
 * @param {string} [props.childName]      Shown to the grown-up on the hand-off screen.
 */
export default function GuardianConsentStep({ onSent, onSkip, childName }) {
  const [step, setStep] = useState(STEP.ASK)
  const [channel, setChannel] = useState(DEFAULT_CONTACT_CHANNEL)
  const [contact, setContact] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState(null)

  const isWhatsApp = channel === CONTACT_CHANNEL.WHATSAPP

  // The same normaliser the server validates with, so an obviously wrong
  // number is refused on the device rather than after a round trip on a slow
  // connection — and refused for the same reason, in the same words.
  const local = useMemo(
    () => normalizeGuardianContact({ contact, channel }),
    [contact, channel],
  )

  const pickChannel = useCallback((value) => {
    setChannel(value)
    setContact('')
    setError('')
  }, [])

  /** Ask the server what it would send, without sending it. */
  const review = useCallback(async (event) => {
    event.preventDefault()
    setError('')
    if (!local.ok) {
      setError(local.message)
      return
    }
    setBusy(true)
    try {
      const result = await previewGuardianConsentRequest({ contact, channel })
      if (result?.allowed === false) {
        // The ladder has not run down yet. Say when, rather than letting the
        // child tap send and meet the same refusal one screen later.
        setError(result.refusal || 'We already sent a message. Please try again later.')
        return
      }
      setConfirmation(result)
      setStep(STEP.CONFIRM)
    } catch (err) {
      setError(failureMessage(err))
    } finally {
      setBusy(false)
    }
  }, [channel, contact, local])

  /** Confirmed: send it for real. */
  const send = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      const result = await sendGuardianConsentRequest({ contact, channel })
      if (result?.waLink) {
        // We cannot message a guardian who has never contacted us (Meta's
        // 24-hour customer-service window), so the composer opens on this
        // device with the message pre-filled and the child presses send.
        window.open(result.waLink, '_blank', 'noopener')
      }
      // The grouped form the child just checked on the confirm screen, not
      // the raw string they typed: showing "0977123456" on the waiting screen
      // after showing "+260 977 123 456" one screen earlier reads as a
      // different number.
      onSent({
        guardianContact: result?.contactDisplay || confirmation?.contactDisplay || contact,
        channel,
      })
    } catch (err) {
      // A delivery failure must not strand the learner on this screen with an
      // account they cannot reach. Say what happened, and leave Resend on the
      // waiting screen and the dashboard as the retry.
      setError(failureMessage(err))
    } finally {
      setBusy(false)
    }
  }, [channel, contact, confirmation, onSent])

  /** The grown-up is in the room: decide here, on this phone. */
  const handOver = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      const result = await startSameDeviceConsent()
      if (!result?.consentUrl) throw new Error('no consent url')
      // A full navigation, not a route change: the consent page is
      // server-rendered HTML that needs no JavaScript, which is the right
      // mechanism for a parent's decision on a low-end phone.
      window.location.assign(result.consentUrl)
    } catch (err) {
      setError(failureMessage(err))
      setBusy(false)
    }
  }, [])

  if (step === STEP.HANDOFF) {
    return (
      <GuardianHandoffStep
        childName={childName}
        busy={busy}
        error={error}
        onContinue={handOver}
        onSendInstead={() => { setError(''); setStep(STEP.ASK) }}
      />
    )
  }

  if (step === STEP.HELP) {
    return (
      <GuardianNoContactHelp
        onBack={() => { setError(''); setStep(STEP.ASK) }}
        onKeepLearning={onSkip}
      />
    )
  }

  if (step === STEP.CONFIRM) {
    return (
      <GuardianContactConfirm
        channel={channel}
        contactDisplay={confirmation?.contactDisplay || local.display}
        preview={confirmation?.preview}
        busy={busy}
        error={error}
        onSend={send}
        onChange={() => { setError(''); setStep(STEP.ASK) }}
        onNoContact={() => { setError(''); setStep(STEP.HELP) }}
      />
    )
  }

  return (
    <form onSubmit={review} noValidate className="space-y-3.5">
      <div>
        <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">
          How can we reach your grown-up?
        </h2>
        <p className="text-[13px] text-[#6B6560] mt-1 leading-[1.55]">
          We&apos;ll send them a message asking if it&apos;s okay for you to use
          ZedExams. You can start learning while you wait.
        </p>
      </div>

      <div
        role="group"
        aria-label="How to reach them"
        className="flex gap-1 rounded-[12px] border border-[#E3D9CC] bg-white p-1"
      >
        {CHANNELS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => pickChannel(value)}
            aria-pressed={channel === value}
            className={`flex-1 rounded-[9px] py-2.5 text-[13px] font-black transition-colors ${
              channel === value ? 'bg-[#C5613F] text-white' : 'bg-transparent text-[#6B6560]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <label
          htmlFor="guardian-contact"
          className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5"
        >
          {isWhatsApp ? 'Their phone number' : 'Their email address'}
        </label>
        <input
          id="guardian-contact"
          name="guardian-contact"
          type={isWhatsApp ? 'tel' : 'email'}
          value={contact}
          onChange={(e) => { setContact(e.target.value); setError('') }}
          autoComplete="off"
          inputMode={isWhatsApp ? 'tel' : 'email'}
          spellCheck={false}
          autoCapitalize="none"
          placeholder={isWhatsApp ? '0977 123456' : 'parent@example.com'}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'guardian-contact-error' : 'guardian-contact-hint'}
          className={FIELD}
        />
        <p id="guardian-contact-hint" className="text-[11.5px] text-[#6B6560] mt-1.5 leading-[1.5]">
          A parent, guardian, or another grown-up who looks after you. Use{' '}
          {isWhatsApp ? 'a number' : 'an address'} they actually check.
        </p>
      </div>

      {error && (
        <p id="guardian-contact-error" role="alert" className="text-red-600 text-[11.5px]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-[10px] bg-[#C5613F] text-white font-black py-3 text-[14px] disabled:opacity-60"
      >
        {busy ? 'Checking…' : 'Send the message'}
      </button>

      {/* The same-device route sits ON this screen rather than behind a
          failure, because for many learners it is the FIRST-best option: the
          adult who owns the phone is often the one sitting next to them. */}
      <button
        type="button"
        onClick={() => { setError(''); setStep(STEP.HANDOFF) }}
        className="w-full flex items-center gap-2.5 rounded-[12px] border border-[rgba(198,123,79,0.3)] bg-[#FFF5EC] px-3 py-2.5 text-left"
      >
        <span className="text-[18px]" aria-hidden="true">👋</span>
        <span className="flex-1">
          <span className="block text-[13px] font-black text-[#96552F]">
            Is your grown-up here right now?
          </span>
          <span className="block text-[11.5px] text-[#96552F] opacity-80">
            They can say yes on this phone
          </span>
        </span>
        <span aria-hidden="true" className="text-[#C5613F] font-black">›</span>
      </button>

      {/* Purpose limitation, stated where the contact is asked for rather
          than in a policy page nobody opens. */}
      <p className="text-[11.5px] text-[#6B6560] text-center leading-[1.7]">
        We only use this to ask permission and send progress updates.
        We never sell it or send adverts.
      </p>

      <p className="text-[11.5px] text-[#6B6560] text-center leading-[1.7]">
        Don&apos;t have a grown-up&apos;s {isWhatsApp ? 'number' : 'address'}?{' '}
        <button
          type="button"
          onClick={() => { setError(''); setStep(STEP.HELP) }}
          className="text-[#C5613F] font-bold underline bg-transparent shadow-none p-0"
        >
          Tell us and we&apos;ll help
        </button>
      </p>

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
