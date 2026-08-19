import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ageInYears } from '../../../utils/guardianConsent'
import { recordAgeGateAttempt } from '../../../utils/ageGateService'
import {
  DOB_SOURCE,
  GRADE_OPTIONS,
  birthYearOptions,
  deriveDobFromGrade,
  deriveDobFromYear,
  digitsOnly,
  evaluateDobEntry,
  formatDobEcho,
  shouldAdvance,
  splitIso,
  typicalAgeForGrade,
} from '../../../utils/ageAnswerCore'

/**
 * The neutral age screen (Play Families policy).
 *
 * ZedExams is a MIXED-AUDIENCE app — upper-primary children (Grades 4–7, the
 * learner app currently open to Grade 7) and adult teachers in one product —
 * which is exactly the case Play requires a neutral age screen for. "Neutral"
 * is a specific claim with several parts, and each one is a decision in this
 * file rather than a comment:
 *
 *   1. ASK PLAINLY. The question is "When were you born?" and nothing on this
 *      screen explains what happens next. A hint that a younger answer means
 *      a smaller app teaches the user which answer to give, which is the one
 *      failure mode the requirement exists to prevent.
 *
 *   2. NOTHING IS PRE-FILLED. Three empty boxes; no default year. (A LOCKED
 *      answer is pre-filled — see below — but that is the user's own earlier
 *      answer, not a suggestion from us.)
 *
 *   3. NO RETRY WITH AN OLDER AGE. Two layers, neither of which is this
 *      component's alone: the server-side cooldown (recordAgeGateAttempt) and
 *      the per-device lock the sign-up flow passes in as `lockedDob`. Backing
 *      out of sign-up and returning shows the first answer, read-only.
 *
 *   4. NO MINIMUM AGE, BUT A PLAUSIBILITY WINDOW. Every real, plausible date
 *      proceeds; routing by age is what the screen is for. What IS refused is
 *      a date nobody filling in this form can have — under 4 or over 100 —
 *      and it is refused at BOTH ends in the same words ("that would make you
 *      N years old — check the year"). The symmetry is the neutrality: a
 *      gentler refusal at one end is a hint about which end is welcome.
 *      See MIN_PLAUSIBLE_AGE in ageAnswerCore.js.
 *
 * It renders BEFORE any sign-up method. That placement is the substance of
 * the whole thing — while the age question lived inside the email form, the
 * Google button was a way around it, and a bypassable age screen counts as no
 * age screen at all.
 *
 * ── What changed from the three dropdowns ────────────────────────────────
 *
 * The Day / Month / Year `<select>`s were three modal pickers on Android and
 * a year list a child born in 2014 had to scroll a long way down. They are now
 * three numeric fields that auto-advance: one keyboard, about four seconds,
 * and no scrolling. Two things came with that and both are load-bearing:
 *
 *   • THE AGE IS ECHOED BACK, and Continue does not enable until it has been.
 *     A child who types 2004 for 2014 reads "That makes you 22 years old" and
 *     fixes it. That single typo is precisely how a twelve-year-old ends up in
 *     an adult account with no guardian — the failure the gate exists for.
 *
 *   • "I'M NOT SURE OF MY BIRTHDAY" IS NOT A DEAD END. Some children genuinely
 *     do not know it, and a hard-required three-field form simply stops them
 *     at the door. Three ways out (year only, from the grade they are in, hand
 *     the phone to a grown-up), and every ESTIMATE that lands anywhere near
 *     the consent age is recorded below it. Fail safe, not fail open.
 *
 * What this screen does NOT do: collect a guardian contact. That moved to
 * GuardianConsentStep, after the account exists, so a learner starts
 * practising immediately in limited mode instead of being held at a form
 * asking for their parent's email address.
 */

const FIELD_BOX =
  'w-full rounded-[12px] border-2 border-[#E3D9CC] bg-white px-2 py-3 text-center ' +
  'text-[22px] font-black tracking-[2px] text-[#1A1F2E] tabular-nums ' +
  'placeholder:text-[#C9C0B4] placeholder:font-bold ' +
  'focus:outline-none focus:border-[#C5613F] focus:ring-4 focus:ring-[#C5613F]/15 ' +
  'disabled:bg-[#F6F1EA] disabled:text-[#6B6560] disabled:cursor-not-allowed'

const FIELD_BOX_BAD = FIELD_BOX.replace('border-[#E3D9CC]', 'border-[#C0392B]')

const LABEL = 'block text-[11px] font-black uppercase tracking-[0.08em] text-[#6B6560] mb-1.5'

const SELECT =
  'w-full rounded-[12px] border-2 border-[#E3D9CC] bg-white px-3 py-3 text-[15px] ' +
  'text-[#1A1F2E] focus:outline-none focus:border-[#C5613F] focus:ring-4 focus:ring-[#C5613F]/15'

const PRIMARY =
  'w-full rounded-[12px] bg-[#C5613F] text-white font-black py-3.5 text-[15px] ' +
  'disabled:bg-[#E6E1DA] disabled:text-[#A29A91] disabled:cursor-default'

const GHOST =
  'w-full rounded-[12px] bg-white border-[1.5px] border-[#E3D9CC] text-[#8A4A2E] ' +
  'font-black py-3 text-[14px]'

/** The sub-screens this step can be on. */
const VIEW = Object.freeze({
  TYPE: 'type',
  NOT_SURE: 'not_sure',
  YEAR: 'year',
  GRADE: 'grade',
  GROWN_UP: 'grown_up',
})

/**
 * @param {object} props
 * @param {(answer: {dob: string, dobSource: string}) => void} props.onAnswer
 *   Called once with a valid date and how it was arrived at. Routing by age
 *   happens in the flow, not here.
 * @param {string} [props.lockedDob]  A date this device already answered with,
 *   inside the retry window. Shown, pre-filled and read-only.
 */
export default function AgeGateStep({ onAnswer, lockedDob = null }) {
  const initial = useMemo(() => splitIso(lockedDob), [lockedDob])
  const [day, setDay] = useState(initial.day)
  const [month, setMonth] = useState(initial.month)
  const [year, setYear] = useState(initial.year)
  const [view, setView] = useState(VIEW.TYPE)
  const [pickedYear, setPickedYear] = useState('')
  const [pickedGrade, setPickedGrade] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const dayRef = useRef(null)
  const monthRef = useRef(null)
  const yearRef = useRef(null)

  const locked = Boolean(lockedDob)

  // A lock that arrives after mount (storage read resolving, or a second
  // visit within the window) still has to reach the fields.
  useEffect(() => {
    if (!locked) return
    setDay(initial.day)
    setMonth(initial.month)
    setYear(initial.year)
    setView(VIEW.TYPE)
  }, [locked, initial])

  // The live verdict. Recomputed on every keystroke because it IS the
  // feedback — an echo that only appears on submit catches nothing.
  const verdict = useMemo(
    () => evaluateDobEntry({ day, month, year }, ageInYears),
    [day, month, year],
  )

  // A locked answer is confirmed, not re-validated: it passed this screen once
  // already, and re-running the check on our own stored value would be a way
  // to block someone with their own previous answer.
  const canContinue = locked || verdict.status === 'ok'
  const echo = verdict.status === 'ok' ? formatDobEcho(verdict.iso, verdict.age) : null

  /**
   * Hand an answer up, after the server cooldown has had its say.
   *
   * Shared by all four routes (typed, year-only, grade, locked) so a new route
   * cannot accidentally skip the cooldown — which is the kind of thing that is
   * invisible until someone tries the retry it was meant to stop.
   */
  const submitAnswer = useCallback(async (dob, dobSource, { skipCooldown = false } = {}) => {
    setError('')
    if (skipCooldown) {
      onAnswer({ dob, dobSource })
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
          'You have already answered this today. Please ask a grown-up to help you, ' +
          'or try again tomorrow.',
        )
        return
      }
    } catch {
      // Fail open: the cooldown is an anti-retry speed bump, not an
      // authorisation check, and an outage must not block signup.
    } finally {
      setBusy(false)
    }
    onAnswer({ dob, dobSource })
  }, [onAnswer])

  const submitTyped = useCallback((event) => {
    event.preventDefault()
    if (locked) {
      submitAnswer(lockedDob, DOB_SOURCE.TYPED, { skipCooldown: true })
      return
    }
    if (verdict.status !== 'ok') {
      // Continue is disabled until the echo shows, so this is the keyboard
      // "done"/Enter path rather than a click. Say what is missing instead of
      // doing nothing, which reads as a broken button.
      setError(verdict.message || 'Please fill in the day, month and year.')
      return
    }
    submitAnswer(verdict.iso, DOB_SOURCE.TYPED)
  }, [locked, lockedDob, verdict, submitAnswer])

  /** One numeric box: digits only, and the caret moves on when it is full. */
  function numberField({ id, label, value, setValue, max, next, ref, placeholder }) {
    return (
      <div className={max === 4 ? 'col-span-2' : ''}>
        <label htmlFor={id} className={LABEL}>{label}</label>
        <input
          id={id}
          ref={ref}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          maxLength={max}
          placeholder={placeholder}
          value={value}
          disabled={locked}
          aria-invalid={
            verdict.status !== 'ok' && verdict.status !== 'incomplete' ? 'true' : undefined
          }
          onChange={(e) => {
            const cleaned = digitsOnly(e.target.value, max)
            setValue(cleaned)
            setError('')
            if (next && shouldAdvance(cleaned, max)) next.current?.focus()
          }}
          onKeyDown={(e) => {
            // Backspace out of an empty box steps back, so a correction does
            // not need a tap. Without it the auto-advance is a one-way door.
            if (e.key === 'Backspace' && !value && ref !== dayRef) {
              const back = ref === yearRef ? monthRef : dayRef
              back.current?.focus()
            }
          }}
          className={
            verdict.status !== 'ok' && verdict.status !== 'incomplete' ? FIELD_BOX_BAD : FIELD_BOX
          }
        />
      </div>
    )
  }

  // ── "I'm not sure" — the three ways out ─────────────────────────────
  if (view === VIEW.NOT_SURE) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-display font-black text-[19px] text-[#1A1F2E]">That&apos;s alright</h2>
          <p className="text-[13.5px] text-[#6B6560] mt-1">
            Lots of people don&apos;t know the exact day. Just tell us roughly.
          </p>
        </div>

        <div className="rounded-[14px] border border-[#EDE5DA] bg-white overflow-hidden">
          <NotSureOption
            emoji="🎂"
            title="I know the year only"
            hint="Pick the year you were born"
            onClick={() => { setError(''); setView(VIEW.YEAR) }}
          />
          <NotSureOption
            emoji="🎓"
            title="I know my grade"
            hint="We'll work out roughly how old you are"
            onClick={() => { setError(''); setView(VIEW.GRADE) }}
          />
          <NotSureOption
            emoji="👪"
            title="Ask my grown-up"
            hint="They can help you finish this"
            onClick={() => { setError(''); setView(VIEW.GROWN_UP) }}
            last
          />
        </div>

        {/* Neutral by construction: it says we would rather ask than guess,
            and nothing at all about what any answer leads to. */}
        <div className="rounded-[12px] bg-[#F5EFE7] px-3.5 py-3 text-[12.5px] leading-[1.6] text-[#7A5030]">
          <b className="block mb-0.5">Why we need something</b>
          We would rather ask than guess. Whatever you tell us, you can start
          learning straight away.
        </div>

        <button type="button" className={GHOST} onClick={() => setView(VIEW.TYPE)}>
          ← Go back and type it
        </button>
      </div>
    )
  }

  // ── Year only ───────────────────────────────────────────────────────
  if (view === VIEW.YEAR) {
    const years = birthYearOptions()
    return (
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const derived = deriveDobFromYear(pickedYear, ageInYears)
          if (!derived.iso) { setError(derived.message); return }
          submitAnswer(derived.iso, derived.source)
        }}
      >
        <div>
          <h2 className="font-display font-black text-[19px] text-[#1A1F2E]">
            Which year were you born?
          </h2>
          <p className="text-[13.5px] text-[#6B6560] mt-1">
            Pick the year. We don&apos;t need the exact day.
          </p>
        </div>

        <div>
          <label htmlFor="dob-year-only" className={LABEL}>Year</label>
          <select
            id="dob-year-only"
            className={SELECT}
            value={pickedYear}
            onChange={(e) => { setPickedYear(e.target.value); setError('') }}
          >
            <option value="">Choose a year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {error && <p role="alert" className="text-[#C0392B] text-[12px]">{error}</p>}

        <button type="submit" className={PRIMARY} disabled={busy || !pickedYear}>
          {busy ? 'Just a moment…' : 'Continue'}
        </button>
        <button type="button" className={GHOST} onClick={() => { setError(''); setView(VIEW.NOT_SURE) }}>
          ← Back
        </button>
      </form>
    )
  }

  // ── From the grade they are in ──────────────────────────────────────
  if (view === VIEW.GRADE) {
    return (
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const derived = deriveDobFromGrade(pickedGrade, ageInYears)
          if (!derived.iso) { setError(derived.message); return }
          submitAnswer(derived.iso, derived.source)
        }}
      >
        <div>
          <h2 className="font-display font-black text-[19px] text-[#1A1F2E]">
            Which grade are you in?
          </h2>
          <p className="text-[13.5px] text-[#6B6560] mt-1">
            We&apos;ll work out roughly how old you are from this.
          </p>
        </div>

        <div>
          <label htmlFor="dob-grade" className={LABEL}>Grade</label>
          <select
            id="dob-grade"
            className={SELECT}
            value={pickedGrade}
            onChange={(e) => { setPickedGrade(e.target.value); setError('') }}
          >
            <option value="">Choose your grade</option>
            {GRADE_OPTIONS.map((g) => <option key={g} value={g}>Grade {g}</option>)}
          </select>
        </div>

        {/* The estimate, shown before it is accepted — the same courtesy the
            typed path gets. It is deliberately hedged ("about"), because it
            IS a guess and presenting it as a fact would invite a correction
            the learner has no way to make. */}
        {typicalAgeForGrade(pickedGrade) !== null && (
          <p className="rounded-[12px] bg-[#EAF4EE] px-3.5 py-3 text-[13px] font-bold text-[#1D6B48]">
            That usually means you are about {typicalAgeForGrade(pickedGrade)} years old.
          </p>
        )}

        {error && <p role="alert" className="text-[#C0392B] text-[12px]">{error}</p>}

        <button type="submit" className={PRIMARY} disabled={busy || !pickedGrade}>
          {busy ? 'Just a moment…' : 'Continue'}
        </button>
        <button type="button" className={GHOST} onClick={() => { setError(''); setView(VIEW.NOT_SURE) }}>
          ← Back
        </button>
      </form>
    )
  }

  // ── Hand the phone to a grown-up ────────────────────────────────────
  //
  // This is the third resolution and the only one that does not end in a date
  // typed by the learner. It cannot hand off to a guardian by EMAIL, because
  // there is no account yet to attach a consent request to — the guardian step
  // comes after sign-up for good reasons (a learner starts practising in
  // limited mode instead of waiting at a form). So the hand-off is the one
  // that actually works at this point in the flow: the person who knows the
  // date fills it in, on this device, now. It always returns to a screen that
  // can finish, which is what "not a dead end" has to mean.
  if (view === VIEW.GROWN_UP) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-display font-black text-[19px] text-[#1A1F2E]">
            Ask a grown-up to help
          </h2>
          <p className="text-[13.5px] text-[#6B6560] mt-1">
            Give them your phone. They can type your birthday for you — it only
            takes a moment.
          </p>
        </div>

        <div className="rounded-[12px] bg-[#F5EFE7] px-3.5 py-3 text-[12.5px] leading-[1.6] text-[#7A5030]">
          <b className="block mb-0.5">If nobody is around right now</b>
          Go back and tell us the year you were born, or the grade you are in.
          That is enough to get you started.
        </div>

        <button type="button" className={PRIMARY} onClick={() => { setError(''); setView(VIEW.TYPE) }}>
          They&apos;re here — type it now
        </button>
        <button type="button" className={GHOST} onClick={() => { setError(''); setView(VIEW.NOT_SURE) }}>
          ← Back
        </button>
      </div>
    )
  }

  // ── The date fields ─────────────────────────────────────────────────
  return (
    <form onSubmit={submitTyped} noValidate className="space-y-4">
      {/* Neutral by construction: the question, a reason that reveals
          nothing, and no mention of what any answer leads to. */}
      <div>
        <h2 className="font-display font-black text-[19px] text-[#1A1F2E]">When were you born?</h2>
        <p className="text-[13.5px] text-[#6B6560] mt-1">
          We ask so we can set up the right account for you.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {numberField({
          id: 'dob-day', label: 'Day', value: day, setValue: setDay,
          max: 2, next: monthRef, ref: dayRef, placeholder: 'DD',
        })}
        {numberField({
          id: 'dob-month', label: 'Month', value: month, setValue: setMonth,
          max: 2, next: yearRef, ref: monthRef, placeholder: 'MM',
        })}
        {numberField({
          id: 'dob-year', label: 'Year', value: year, setValue: setYear,
          max: 4, next: null, ref: yearRef, placeholder: 'YYYY',
        })}
      </div>

      {/* The echo. `role="status"` rather than an alert: it is confirmation,
          not a problem, and a screen reader announcing it as an error every
          time a correct date is typed would be its own small cruelty. */}
      {echo && (
        <div
          role="status"
          className="rounded-[12px] bg-[#EAF4EE] px-3.5 py-3 flex items-start gap-2.5"
        >
          <span aria-hidden="true" className="text-[#1D6B48] font-black leading-none mt-0.5">✓</span>
          <div>
            <p className="text-[13.5px] font-black text-[#12643F]">{echo.headline}</p>
            <p className="text-[12px] font-bold text-[#12643F]/80 mt-0.5">{echo.detail}</p>
          </div>
        </div>
      )}

      {(verdict.message || error) && (
        <p role="alert" className="rounded-[12px] bg-[#FBEAE8] px-3.5 py-3 text-[13px] font-bold text-[#9B2C22]">
          {error || verdict.message}
        </p>
      )}

      <button type="submit" disabled={busy || !canContinue} className={PRIMARY}>
        {busy ? 'Just a moment…' : 'Continue'}
      </button>

      {/* Never a dead end. A required three-field form stops a child who
          genuinely does not know their birthday, at the door, permanently. */}
      {!locked && (
        <p className="text-center">
          <button
            type="button"
            onClick={() => { setError(''); setView(VIEW.NOT_SURE) }}
            className="text-[12.5px] font-black text-[#8A4A2E] underline underline-offset-2"
          >
            I&apos;m not sure of my birthday
          </button>
        </p>
      )}

      <p className="text-[11.5px] text-[#6B6560] text-center leading-[1.65]">
        Only you and your grown-up will see this.<br />
        We never show your birthday to other learners.
      </p>
    </form>
  )
}

function NotSureOption({ emoji, title, hint, onClick, last = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full flex items-center gap-3 px-3.5 py-3.5 text-left ' +
        (last ? '' : 'border-b border-[#EDE5DA]')
      }
    >
      <span
        aria-hidden="true"
        className="w-9 h-9 rounded-[11px] bg-[#F5EFE7] grid place-items-center text-[17px] flex-shrink-0"
      >
        {emoji}
      </span>
      <span className="flex-1">
        <span className="block text-[14.5px] font-black text-[#1A1F2E]">{title}</span>
        <span className="block text-[12px] text-[#6B6560] mt-0.5">{hint}</span>
      </span>
      <span aria-hidden="true" className="text-[#C9C0B4] text-[18px]">›</span>
    </button>
  )
}
