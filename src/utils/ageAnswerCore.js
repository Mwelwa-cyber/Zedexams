/**
 * ageAnswerCore — everything the age screen decides about a date, as rules
 * rather than as JSX.
 *
 * The screen it serves used to be three `<select>` dropdowns. On Android that
 * is three modal pickers and a year list a child born in 2014 has to scroll a
 * long way down, and it produced the one mistake the age gate exists to catch:
 * a mistyped year that drops a twelve-year-old into an adult account with no
 * guardian. The replacement is three numeric fields, an age echoed back before
 * Continue is enabled, and a path for a child who genuinely does not know
 * their birthday. All three need logic, and all three need to be checkable
 * without a browser — hence this file.
 *
 * Pure: no DOM, no storage, no React, no clock of its own (`now` is always a
 * parameter, so the boundary cases are tested rather than argued about).
 *
 * ── Why the derived dates all fail towards "under 18" ────────────────────
 *
 * Two of the three "I'm not sure" routes produce an ESTIMATE. An estimate that
 * happens to read as 18 buys an adult account for a child, with no guardian
 * ever asked — the exact outcome the guardian-consent gate is built to
 * prevent. So every derivation here picks the YOUNGEST reading of what it was
 * told (31 December of the birth year), and anything landing within a year of
 * the consent age is pulled below it outright. Fail safe, not fail open.
 *
 * ── One source, not a second flag ───────────────────────────────────────
 *
 * These functions return a DATE, never a "treat as minor" boolean. The
 * account's `dob` is the single value the age gate reads from
 * (`requiresGuardianConsent`), and a parallel flag saying otherwise would be a
 * second source of truth that the server-side recomputation could not see.
 * `DOB_SOURCE` records how the date was arrived at, for support and audit —
 * nothing routes on it.
 */

import { GUARDIAN_CONSENT_AGE } from './guardianConsent.js'

/**
 * The plausibility window.
 *
 * Both ends are treated as TYPOS, in identical language, and that symmetry is
 * the point. A screen that refuses young answers with a different tone than it
 * refuses old ones is teaching the user which answer is welcome, which is the
 * one thing a neutral age screen must not do. "That would make you 2 years
 * old — check the year" says nothing about what any answer unlocks; it says
 * the number is not one a person filling in this form can have.
 *
 * 4 rather than 0: nobody signs themselves up for exam practice at three, and
 * a `20014` slip in the year box is far likelier than a toddler. 100 matches
 * the ceiling the flow's own checkAgeAnswer has always used.
 */
export const MIN_PLAUSIBLE_AGE = 4
export const MAX_PLAUSIBLE_AGE = 100

/** How the date on the account was arrived at. Recorded, never routed on. */
export const DOB_SOURCE = Object.freeze({
  /** The learner typed a full day/month/year. */
  TYPED: 'typed',
  /** The learner knew only the year; the day and month are our conservative pick. */
  YEAR_ONLY: 'year_only',
  /** Estimated from the grade the learner is in. */
  GRADE: 'grade',
})

const DOB_SOURCES = Object.freeze(Object.values(DOB_SOURCE))

/** Is this a value we would accept as a `dobSource`? */
export function isKnownDobSource(value) {
  return DOB_SOURCES.includes(value)
}

/**
 * How far from the consent age an ESTIMATE has to be before we believe it.
 *
 * A grade tells you someone's age to within about two years — repeated grades,
 * a late start, a birthday either side of the school year. So an estimate of
 * 18 is really "somewhere between 16 and 20", and reading it as an adult is a
 * coin toss with a child's account on it. Anything inside the band is recorded
 * as a minor and a guardian is asked; the cost of being wrong in that
 * direction is one email to a grown-up who confirms and moves on.
 */
export const BOUNDARY_BAND_YEARS = 1

/**
 * Typical age at each grade in the Zambian system: entry to Grade 1 at 7, one
 * grade a year. Used ONLY to estimate an age for a learner who does not know
 * their birthday — it never sets the account's grade, which the setup wizard
 * asks for separately and for its own reasons.
 */
export const GRADE_OPTIONS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => i + 1),
)

/** @param {number} grade @return {number|null} */
export function typicalAgeForGrade(grade) {
  const g = Number(grade)
  if (!Number.isInteger(g) || g < 1 || g > 12) return null
  return g + 6
}

const MONTHS = Object.freeze([
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
])

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Keep only digits, capped to `max` of them. What each numeric field stores. */
export function digitsOnly(value, max) {
  const digits = String(value ?? '').replace(/\D+/g, '')
  return Number.isFinite(max) ? digits.slice(0, max) : digits
}

/**
 * Is this field full enough to move the caret on?
 *
 * Day and month advance at two digits, year at four. Deliberately NOT "a value
 * that could not grow" (a `4` in the day box could still become `14`), because
 * jumping the caret out from under someone mid-number is worse than one extra
 * tap.
 */
export function shouldAdvance(value, length) {
  return digitsOnly(value).length >= length
}

/** Compose the three field values into an ISO date, or null if any is short. */
export function composeIso({ day, month, year } = {}) {
  const d = digitsOnly(day, 2)
  const m = digitsOnly(month, 2)
  const y = digitsOnly(year, 4)
  if (!d.length || !m.length || y.length !== 4) return null
  return `${y}-${pad2(Number(m))}-${pad2(Number(d))}`
}

/** "14 March 2014", for reading an ISO date back to a child. */
export function formatLongDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim())
  if (!m) return ''
  const month = MONTHS[Number(m[2]) - 1]
  if (!month) return ''
  return `${Number(m[3])} ${month} ${m[1]}`
}

/** Split an ISO date back into the three field values, or blanks. */
export function splitIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim())
  if (!m) return { day: '', month: '', year: '' }
  return { day: m[3], month: m[2], year: m[1] }
}

/**
 * The one verdict the screen renders.
 *
 * Every branch carries the message the learner actually sees, so the copy is
 * testable under plain `node` and cannot drift between an error state and the
 * assertion that the error state exists.
 *
 * @param {{day: string, month: string, year: string}} parts
 * @param {(iso: string, asOf?: Date) => number|null} ageInYears  From the shared
 *   consent core — the SAME function the account's minor status is derived
 *   from, so the age echoed to the learner and the age the gate reads can only
 *   disagree about the input.
 * @param {Date} [now]
 * @return {{status: string, iso: string|null, age: number|null, message: string}}
 *   status ∈ incomplete | unreadable | future | too_young | too_old | ok
 */
export function evaluateDobEntry(parts, ageInYears, now = new Date()) {
  const iso = composeIso(parts)
  if (!iso) {
    return { status: 'incomplete', iso: null, age: null, message: '' }
  }

  const age = ageInYears(iso, now)

  // ageInYears returns null for a date that is not real (31 February) AND for
  // one in the future. They need different copy: "check the day and month" is
  // useless advice to someone whose year is next year, and telling a child to
  // check their day when the day is fine is how a form becomes a maze.
  if (age === null) {
    const year = Number(digitsOnly(parts?.year, 4))
    const thisYear = now.getUTCFullYear()
    if (Number.isFinite(year) && year > thisYear) {
      return {
        status: 'future',
        iso: null,
        age: null,
        message: 'That year has not happened yet — check the year.',
      }
    }
    return {
      status: 'unreadable',
      iso: null,
      age: null,
      message: "That date doesn't look right — check the day and month.",
    }
  }

  if (age < MIN_PLAUSIBLE_AGE) {
    return {
      status: 'too_young',
      iso: null,
      age,
      message: `That would make you ${age} ${age === 1 ? 'year' : 'years'} old — check the year.`,
    }
  }
  if (age > MAX_PLAUSIBLE_AGE) {
    return {
      status: 'too_old',
      iso: null,
      age,
      message: `That would make you ${age} years old — check the year.`,
    }
  }

  return { status: 'ok', iso, age, message: '' }
}

/**
 * The age echo. Two lines, because they do different jobs: the age is the part
 * that catches a wrong year at a glance, and the long date is the part that
 * lets someone check the digits they actually typed.
 */
export function formatDobEcho(iso, age) {
  return {
    headline: `That makes you ${age} ${age === 1 ? 'year' : 'years'} old`,
    detail: `${formatLongDate(iso)} — is that right?`,
  }
}

/**
 * The youngest date of birth consistent with being `age` years old today.
 *
 * 31 December of the birth year: someone born on it has only just turned
 * `age - 1` in most of the calendar, which is the conservative reading and the
 * whole reason every derivation routes through here.
 */
export function dobForBirthYear(year, now = new Date()) {
  const y = Number(year)
  if (!Number.isInteger(y)) return null
  const thisYear = now.getUTCFullYear()
  if (y > thisYear || y < thisYear - MAX_PLAUSIBLE_AGE) return null
  return `${y}-12-31`
}

/**
 * Pull an ESTIMATE below the consent age when it lands too close to it.
 *
 * Applies to derived dates only. A typed date is what the learner told us and
 * is recorded as given — nudging that would be inventing an answer, and it
 * would also make the echo they confirmed a lie.
 */
export function clampEstimateBelowConsentAge(iso, ageInYears, now = new Date()) {
  const age = ageInYears(iso, now)
  if (age === null) return iso
  if (age > GUARDIAN_CONSENT_AGE + BOUNDARY_BAND_YEARS) return iso
  if (age < GUARDIAN_CONSENT_AGE - BOUNDARY_BAND_YEARS) return iso
  // Inside the band (or already at it): record the youngest year that is
  // unambiguously below the consent age.
  return dobForBirthYear(now.getUTCFullYear() - (GUARDIAN_CONSENT_AGE - BOUNDARY_BAND_YEARS), now)
}

/**
 * "I know the year only" → a date.
 *
 * @return {{iso: string|null, source: string, message: string}}
 */
export function deriveDobFromYear(year, ageInYears, now = new Date()) {
  const base = dobForBirthYear(digitsOnly(year, 4), now)
  if (!base) {
    return { iso: null, source: DOB_SOURCE.YEAR_ONLY, message: 'Please choose the year you were born.' }
  }
  const age = ageInYears(base, now)
  if (age === null || age < MIN_PLAUSIBLE_AGE || age > MAX_PLAUSIBLE_AGE) {
    return { iso: null, source: DOB_SOURCE.YEAR_ONLY, message: 'That year does not look right — please check it.' }
  }
  return {
    iso: clampEstimateBelowConsentAge(base, ageInYears, now),
    source: DOB_SOURCE.YEAR_ONLY,
    message: '',
  }
}

/**
 * "I know my grade" → a date.
 *
 * The grade picked here is used for arithmetic and then discarded. It is NOT
 * written to the account: the setup wizard asks for a grade separately, it
 * changes what the learner sees on the very next screen, and a guess made to
 * escape a date field is not an answer to that question.
 */
export function deriveDobFromGrade(grade, ageInYears, now = new Date()) {
  const age = typicalAgeForGrade(grade)
  if (age === null) {
    return { iso: null, source: DOB_SOURCE.GRADE, message: 'Please choose the grade you are in.' }
  }
  const base = dobForBirthYear(now.getUTCFullYear() - age, now)
  return {
    iso: clampEstimateBelowConsentAge(base, ageInYears, now),
    source: DOB_SOURCE.GRADE,
    message: '',
  }
}

/**
 * The years offered by the year-only picker, newest first.
 *
 * Newest first for the same reason the old year dropdown ran that way: the
 * first option a user lands on must not be an adult date.
 */
export function birthYearOptions(now = new Date()) {
  const thisYear = now.getUTCFullYear()
  const oldest = thisYear - MAX_PLAUSIBLE_AGE
  const newest = thisYear - MIN_PLAUSIBLE_AGE
  return Array.from({ length: newest - oldest + 1 }, (_, i) => newest - i)
}
