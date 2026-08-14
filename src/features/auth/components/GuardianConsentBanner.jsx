import { useCallback, useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { resolveLearnerAccess, CONSENT_STATUS } from '../../../utils/guardianConsent'
import { sendGuardianConsentRequest } from '../../../utils/ageGateService'

/**
 * The learner-facing half of limited mode, and the migration prompt for
 * accounts that predate the consent flow.
 *
 * The server is what actually refuses (functions/consentGuard.js). This is
 * what tells a child WHY, and gives them the one action that fixes it. A gate
 * with no visible explanation is indistinguishable from a broken app, and a
 * nine-year-old will conclude the second one.
 *
 * ── Three states, three different asks ──────────────────────────────────
 *
 *   pending / expired — a guardian was named and has not answered. The action
 *     is Resend, rate-limited to once a day by the server (the recipient did
 *     not ask for any of this).
 *
 *   unknown — an account created before this flow existed. The action is to
 *     ADD a guardian, because we have never asked. This is the migration
 *     prompt, and it is deliberately not blocking: `enforceGuardianConsentMigration`
 *     is off by default, so these learners keep working while the fleet
 *     migrates. The banner is how the fleet migrates.
 *
 *   denied — a guardian said no. There is no action a child can take, so the
 *     banner offers none; it points at support, which is the only real route.
 *
 * A granted or adult account renders nothing at all.
 */

const WRAP = 'rounded-radius-md border px-3 py-2.5 text-[13px] leading-relaxed mb-3'

export default function GuardianConsentBanner() {
  const { currentUser, userProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [contact, setContact] = useState('')
  const [method, setMethod] = useState('email')
  const [adding, setAdding] = useState(false)

  const access = useMemo(
    // enforceMigration is deliberately NOT passed: this banner should appear
    // for an unmigrated account whether or not enforcement is switched on.
    // Showing it early is how guardians get collected before the switch.
    () => resolveLearnerAccess(userProfile),
    [userProfile],
  )

  const resend = useCallback(async () => {
    setBusy(true)
    setNote('')
    try {
      const res = await sendGuardianConsentRequest()
      if (res?.waLink) {
        // WhatsApp: we cannot message a guardian who has never contacted us
        // (Meta's 24-hour window), so the composer opens on this device with
        // the message pre-filled.
        window.open(res.waLink, '_blank', 'noopener')
        setNote('WhatsApp is open — send the message to your parent or guardian.')
      } else {
        setNote('Sent. Ask them to check their email.')
      }
    } catch (err) {
      setNote(
        err?.code === 'functions/resource-exhausted'
          ? 'We already sent a link today. Please try again tomorrow.'
          : 'We could not send that just now. Please try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  const addGuardian = useCallback(async (event) => {
    event.preventDefault()
    const value = contact.trim()
    const okEmail = method === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    const okPhone = method === 'whatsapp' && /^\+?\d{9,15}$/.test(value.replace(/[\s-]/g, ''))
    if (!okEmail && !okPhone) {
      setNote(
        method === 'email'
          ? "Please enter your parent or guardian's email address."
          : "Please enter their WhatsApp number, e.g. +260 97 1234567.",
      )
      return
    }
    setBusy(true)
    setNote('')
    try {
      // The contact is handed to the SERVER, not written from here.
      // firestore.rules blocks the client from touching `guardian` at all,
      // because a client that could edit the contact could edit
      // consentStatus alongside it and approve its own account.
      const res = await sendGuardianConsentRequest({ contact: value, method })
      if (res?.waLink) {
        window.open(res.waLink, '_blank', 'noopener')
        setNote('WhatsApp is open — send the message to your parent or guardian.')
      } else {
        setNote('Sent. Ask them to check their messages.')
      }
      setAdding(false)
    } catch (err) {
      setNote(
        err?.message && err?.code === 'functions/invalid-argument'
          ? err.message
          : 'We could not save that just now. Please try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }, [contact, method])

  if (!currentUser || !userProfile) return null
  if (access.reason === 'not-a-learner' || access.reason === 'adult-learner') return null
  if (access.status === CONSENT_STATUS.GRANTED) return null

  if (access.status === CONSENT_STATUS.DENIED) {
    return (
      <div className={`${WRAP} border-rose-200 bg-rose-50 text-rose-900`} role="status">
        <strong className="font-black">This account has been switched off.</strong>{' '}
        A parent or guardian asked us to remove it. If that was a mistake, ask them to
        email <a className="underline font-bold" href="mailto:support@zedexams.com">support@zedexams.com</a>.
      </div>
    )
  }

  const needsGuardian = access.status === CONSENT_STATUS.UNKNOWN

  return (
    <div className={`${WRAP} border-amber-200 bg-amber-50 text-amber-900`} role="status">
      <p>
        <strong className="font-black">
          {needsGuardian
            ? 'We need a parent or guardian to approve your account.'
            : access.status === CONSENT_STATUS.EXPIRED
              ? 'The approval link we sent has expired.'
              : 'Waiting for a parent or guardian to approve your account.'}
        </strong>{' '}
        {needsGuardian
          ? 'Add their email or WhatsApp number and we will send them a link.'
          : 'You can keep reading lessons and past papers. Ask Zed, classes and leaderboards unlock once they approve.'}
      </p>

      {needsGuardian && !adding && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-2 font-black underline"
        >
          Add a parent or guardian
        </button>
      )}

      {needsGuardian && adding && (
        <form onSubmit={addGuardian} className="mt-2 space-y-2">
          <div className="flex gap-2">
            {[['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setMethod(value); setContact('') }}
                aria-pressed={method === value}
                className={`px-2.5 py-1 rounded-radius-md border text-[12px] font-bold ${
                  method === value ? 'border-amber-700 bg-amber-100' : 'border-amber-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type={method === 'email' ? 'email' : 'tel'}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            aria-label={method === 'email' ? "Parent or guardian's email" : "Parent or guardian's WhatsApp number"}
            placeholder={method === 'email' ? 'parent@example.com' : '+260 97 1234567'}
            className="w-full rounded-radius-md border border-amber-300 bg-white px-2.5 py-1.5 text-[13px]"
          />
          <button
            type="submit"
            disabled={busy}
            className="font-black underline disabled:opacity-60"
          >
            {busy ? 'Sending…' : 'Send them a link'}
          </button>
        </form>
      )}

      {!needsGuardian && (
        <button
          type="button"
          onClick={resend}
          disabled={busy}
          className="mt-2 font-black underline disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Resend the link'}
        </button>
      )}

      {note && <p className="mt-1.5 text-[12px]">{note}</p>}
    </div>
  )
}
