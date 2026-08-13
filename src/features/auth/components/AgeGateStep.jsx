import { useCallback, useEffect, useMemo, useState } from 'react'
import { ageInYears } from '../../../utils/guardianConsent'
import { recordAgeGateAttempt } from '../../../utils/ageGateService'
import { checkAgeAnswer } from '../../../utils/signupFlowCore'

/**
 * The neutral age screen (Play Families policy).
 *
 * ZedExams is a MIXED-AUDIENCE app — children in Grades 4–7 and adult
 * teachers in one product — which is exactly the case Play requires a neutral
 * age screen for. "Neutral" is a specific claim with several parts, and each
 * one is a decision in this file rather than a comment:
 *
 *   1. ASK PLAINLY. The question is "When were you born?" and nothing on this
 *      screen explains what happens next. A hint that a younger answer means
 *      a smaller app teaches the user which answer to give, which is the one
 *      failure mode the requirement exists to prevent.
 *
 *   2. NOTHING IS PRE-FILLED. No default year, no "18+" preselected. The
 *      year list starts empty and runs oldest-last so the first tap is not
 *      an adult date. (A LOCKED answer is pre-filled — see below — but that
 *      is the user's own earlier answer, not a suggestion from us.)
 *
 *   3. NO RETRY WITH AN OLDER AGE. Two layers, neither of which is this
 *      component's alone: the server-side cooldown (recordAgeGateAttempt) and
 *      the per-device lock the sign-up flow passes in as `lockedDob`. Backing
 *      out of sign-up and returning shows the first answer, read-only.
 *
 *   4. NO MINIMUM AGE. Every real, plausible date proceeds. Rejecting young
 *      answers would tell the user which answer is accepted, and there is
 *      nothing to gain: routing by age is what the screen is for.
 *
 * It renders BEFORE any sign-up method. That placement is the substance of
 * the whole thing — while the age question lived inside the email form, the
 * Google button was a way around it, and a bypassable age screen counts as no
 * age screen at all.
 *
 * What this screen does NOT do any more: collect a guardian contact. That
 * moved to GuardianConsentStep, after the account exists, so a learner starts
 * practising immediately in limited mode instead of being held at a form
 * asking for their parent's email address.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const FIELD =
  'w-full rounded-[10px] border border-[#E3D9CC] bg-white px-3 py-2.5 text-[14px] ' +
  'text-[#1A1F2E] focus:outline-none focus:ring-2 focus:ring-[#C5613F] ' +
  'disabled:bg-[#F6F1EA] disabled:text-[#6B6560] disabled:cursor-not-allowed'

function pad(n) {
  return String(n).padStart(2, '0')
}

/** Split an ISO date into the three select values, or blanks. */
function splitIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim())
  if (!m) return { day: '', month: '', year: '' }
  return { day: String(Number(m[3])), month: String(Number(m[2]) - 1), year: m[1] }
}

/**
 * @param {object} props
 * @param {(answer: {dob: string}) => void} props.onAnswer  Called once with a
 *   valid date. Routing by age happens in the flow, not here.
 * @param {string} [props.lockedDob]  A date this device already answered with,
 *   inside the retry window. Shown, pre-filled and read-only.
 */
export default function AgeGateStep({ onAnswer, lockedDob = null }) {
  const initial = useMemo(() => splitIso(lockedDob), [lockedDob])
  const [day, setDay] = useState(initial.day)
  const [month, setMonth] = useState(initial.month)
  const [year, setYear] = useState(initial.year)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const locked = Boolean(lockedDob)

  // A lock that arrives after mount (storage read resolving, or a second
  // visit within the window) still has to reach the fields.
  useEffect(() => {
    if (!locked) return
    setDay(initial.day)
    setMonth(initial.month)
    setYear(initial.year)
  }, [locked, initial])

  // Oldest year last: the first option a user lands on must not be an adult
  // date. 100 years covers any adult teacher and matches the plausibility
  // ceiling in checkAgeAnswer.
  const years = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 100 }, (_, i) => current - i)
  }, [])

  const submit = useCallback(async (event) => {
    event.preventDefault()
    setError('')

    // A locked answer is confirmed, not re-validated. It already passed this
    // screen once, and re-running the server cooldown on it would block the
    // user with their own previous answer.
    if (locked) {
      onAnswer({ dob: lockedDob })
      return
    }

    if (!day || !month || !year) {
      setError('Please choose the day, month and year.')
      return
    }
    const iso = `${year}-${pad(Number(month) + 1)}-${pad(Number(day))}`
    // ageInYears rejects impossible dates (31 February) rather than letting
    // Date roll them into the next month and invent an age, and returns null
    // for a future date. checkAgeAnswer turns that into the two things this
    // screen refuses: an unreadable date, and one over 100 years ago.
    const verdict = checkAgeAnswer(ageInYears(iso))
    if (!verdict.ok) {
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

    onAnswer({ dob: iso })
  }, [day, month, year, locked, lockedDob, onAnswer])

  return (
    <form onSubmit={submit} noValidate className="space-y-3.5">
      {/* Neutral by construction: the question, a reason that reveals
          nothing, and no mention of what any answer leads to. */}
      <div>
        <h2 className="font-display font-black text-[18px] text-[#1A1F2E]">When were you born?</h2>
        <p className="text-[13px] text-[#6B6560] mt-1">
          This helps us set ZedExams up right for you.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label htmlFor="dob-day" className="block text-[12px] text-[#6B6560] mb-1">Day</label>
          <select
            id="dob-day"
            value={day}
            disabled={locked}
            onChange={(e) => setDay(e.target.value)}
            className={FIELD}
          >
            <option value="">–</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="dob-month" className="block text-[12px] text-[#6B6560] mb-1">Month</label>
          <select
            id="dob-month"
            value={month}
            disabled={locked}
            onChange={(e) => setMonth(e.target.value)}
            className={FIELD}
          >
            <option value="">–</option>
            {MONTHS.map((label, i) => <option key={label} value={i}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dob-year" className="block text-[12px] text-[#6B6560] mb-1">Year</label>
          <select
            id="dob-year"
            value={year}
            disabled={locked}
            onChange={(e) => setYear(e.target.value)}
            className={FIELD}
          >
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
