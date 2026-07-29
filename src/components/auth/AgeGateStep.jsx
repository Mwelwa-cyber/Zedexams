import { useCallback, useMemo, useState } from 'react'
import { requiresGuardianConsent, ageInYears } from '../../utils/guardianConsent'
import { recordAgeGateAttempt } from '../../utils/ageGateService'

/**
 * The neutral age screen (Play Families policy), plus guardian capture.
 *
 * ZedExams is a MIXED-AUDIENCE app — children in Grades 4–7 and adult
 * teachers in one product — which is exactly the case Play requires a neutral
 * age screen for. "Neutral" is a specific claim with four parts, and each one
 * is a decision in this file rather than a comment:
 *
 *   1. ASK PLAINLY. The question is "When were you born?" and nothing on this
 *      screen explains what happens next. A hint that a younger answer means
 *      a smaller app teaches the user which answer to give, which is the one
 *      failure mode the requirement exists to prevent.
 *
 *   2. NOTHING IS PRE-FILLED. No default year, no "18+" preselected. The
 *      year list starts empty and runs oldest-last so the first tap is not
 *      an adult date.
 *
 *   3. NO IMMEDIATE RETRY WITH AN OLDER AGE. Enforced SERVER-SIDE
 *      (recordAgeGateAttempt), not here — a cooldown a client owns is a
 *      cooldown a client can clear. This component reports the attempt and
 *      honours the answer.
 *
 *   4. THE ANSWER IS NOT REVERSIBLE ON THIS SCREEN. Once a date is submitted
 *      there is no "go back and change it" affordance, because that is retry
 *      with extra steps.
 *
 * The age threshold and the "unreadable date means child" rule both come from
 * the shared consent core, so the client and the server route the same person
 * the same way.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const FIELD =
  'w-full rounded-[10px] border border-[#E3D9CC] bg-white px-3 py-2.5 text-[14px] ' +
  'text-[#1A1F2E] focus:outline-none focus:ring-2 focus:ring-[#C5613F]'

function pad(n) {
  return String(n).padStart(2, '0')
}

export default function AgeGateStep({ onAdult, onChild }) {
  const [day, setDay] = useState('')
  const [month, setMonth] = useState('')
  const [year, setYear] = useState('')
  const [phase, setPhase] = useState('dob') // 'dob' | 'guardian'
  const [dob, setDob] = useState('')
  const [method, setMethod] = useState('email')
  const [contact, setContact] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Oldest year last: the first option a user lands on must not be an adult
  // date. 100 years covers any adult teacher.
  const years = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 100 }, (_, i) => current - i)
  }, [])

  const submitDob = useCallback(async (event) => {
    event.preventDefault()
    setError('')
    if (!day || !month || !year) {
      setError('Please choose the day, month and year.')
      return
    }
    const iso = `${year}-${pad(Number(month) + 1)}-${pad(Number(day))}`
    // The shared core rejects impossible dates (31 February) rather than
    // letting Date roll them into the next month and invent an age.
    if (ageInYears(iso) === null) {
      setError("That date doesn't look right — please check it.")
      return
    }

    setBusy(true)
    try {
      // Report the attempt so the server can refuse an immediate retry with a
      // different age. A blocked result is honoured, but it never blocks the
      // FIRST attempt — and a failure to reach the server does not stop a
      // real person signing up.
      const { blocked } = await recordAgeGateAttempt()
      if (blocked) {
        setError(
          'You have already answered this today. Please ask a parent or guardian ' +
          'to help you, or try again tomorrow.',
        )
        return
      }
    } catch {
      // Fail open: the cooldown is an anti-retry speed bump, not an
      // authorisation check, and an outage must not block signup.
    } finally {
      setBusy(false)
    }

    setDob(iso)
    if (requiresGuardianConsent(iso)) setPhase('guardian')
    else onAdult({ dob: iso })
  }, [day, month, year, onAdult])

  const submitGuardian = useCallback((event) => {
    event.preventDefault()
    setError('')
    const value = contact.trim()
    const okEmail = method === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    const okPhone = method === 'whatsapp' && /^\+?\d{9,15}$/.test(value.replace(/[\s-]/g, ''))
    if (!okEmail && !okPhone) {
      setError(method === 'email'
        ? "Please enter your parent or guardian's email address."
        : "Please enter your parent or guardian's WhatsApp number, e.g. +260 97 1234567.")
      return
    }
    onChild({ dob, guardian: { contact: value, method, consentStatus: 'pending' } })
  }, [contact, method, dob, onChild])

  if (phase === 'guardian') {
    return (
      <form onSubmit={submitGuardian} noValidate className="space-y-3.5">
        <div>
          <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">One more step</h2>
          <p className="text-[13px] text-[#6B6560] mt-1">
            We need a parent or guardian to approve your account. We&apos;ll send them a
            link. You can start reading lessons and past papers straight away, and
            everything else unlocks once they approve.
          </p>
        </div>

        <div className="flex gap-2" role="group" aria-label="How should we contact them?">
          {[['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMethod(value); setContact(''); setError('') }}
              aria-pressed={method === value}
              className={`px-3 py-2 rounded-[10px] border text-[13px] font-bold ${
                method === value
                  ? 'border-[#C5613F] text-[#C5613F] bg-[#F8EADF]'
                  : 'border-[#E3D9CC] text-[#6B6560]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="guardian-contact" className="block text-[13px] font-medium text-[#1A1F2E] mb-1.5">
            {method === 'email' ? "Parent or guardian's email" : "Parent or guardian's WhatsApp number"}
          </label>
          <input
            id="guardian-contact"
            type={method === 'email' ? 'email' : 'tel'}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            autoComplete="off"
            placeholder={method === 'email' ? 'parent@example.com' : '+260 97 1234567'}
            className={FIELD}
          />
        </div>

        {error && <p role="alert" className="text-red-600 text-[11.5px]">{error}</p>}

        <button
          type="submit"
          className="w-full rounded-[10px] bg-[#C5613F] text-white font-black py-3 text-[14px]"
        >
          Continue
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={submitDob} noValidate className="space-y-3.5">
      {/* Neutral by construction: the question, and nothing about consequences. */}
      <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">When were you born?</h2>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="dob-day" className="block text-[12px] text-[#6B6560] mb-1">Day</label>
          <select id="dob-day" value={day} onChange={(e) => setDay(e.target.value)} className={FIELD}>
            <option value="">–</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dob-month" className="block text-[12px] text-[#6B6560] mb-1">Month</label>
          <select id="dob-month" value={month} onChange={(e) => setMonth(e.target.value)} className={FIELD}>
            <option value="">–</option>
            {MONTHS.map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dob-year" className="block text-[12px] text-[#6B6560] mb-1">Year</label>
          <select id="dob-year" value={year} onChange={(e) => setYear(e.target.value)} className={FIELD}>
            <option value="">–</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && <p role="alert" className="text-red-600 text-[11.5px]">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-[10px] bg-[#C5613F] text-white font-black py-3 text-[14px] disabled:opacity-60"
      >
        {busy ? 'Just a moment…' : 'Continue'}
      </button>
    </form>
  )
}
