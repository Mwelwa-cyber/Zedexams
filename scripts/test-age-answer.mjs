/**
 * test-age-answer — the rules behind the age / date-of-birth screen.
 *
 * The screen makes three claims that are easy to break by accident and
 * expensive to break in production:
 *
 *   1. An implausible date is refused with a message that names what is wrong,
 *      and refused in the SAME language at both ends of the range. A gentler
 *      refusal for young answers is how a child learns which answer to give.
 *   2. The age echoed back is the age the account will be governed by — it is
 *      computed with the same function the guardian-consent gate uses.
 *   3. Every ESTIMATE lands below the consent age when it is anywhere near it.
 *      An estimate that reads as 18 buys an adult account for a child.
 *
 * Plain node, no DOM: these are date rules, and a browser adds nothing to
 * checking them. The rendering half lives in AgeGateStep.spec.jsx.
 */

import assert from 'node:assert/strict'
import { GUARDIAN_CONSENT_AGE, ageInYears } from '../functions/shared/consent/guardianConsentCore.js'
import {
  BOUNDARY_BAND_YEARS,
  DOB_SOURCE,
  GRADE_OPTIONS,
  MAX_PLAUSIBLE_AGE,
  MIN_PLAUSIBLE_AGE,
  birthYearOptions,
  clampEstimateBelowConsentAge,
  composeIso,
  deriveDobFromGrade,
  deriveDobFromYear,
  digitsOnly,
  dobForBirthYear,
  evaluateDobEntry,
  formatDobEcho,
  formatLongDate,
  isKnownDobSource,
  shouldAdvance,
  splitIso,
  typicalAgeForGrade,
} from '../src/utils/ageAnswerCore.js'

const NOW = new Date('2026-08-19T00:00:00Z')

let pass = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++ } catch (err) { failures.push({ name, message: err.message }) }
}

const ev = (day, month, year, now = NOW) =>
  evaluateDobEntry({ day, month, year }, ageInYears, now)

// ── Typing ────────────────────────────────────────────────────────

test('the fields keep digits and nothing else', () => {
  // inputmode="numeric" is a keyboard hint, not a constraint — a paste, a
  // hardware keyboard and a swipe keyboard can all put letters in the box.
  assert.equal(digitsOnly('1a4', 2), '14')
  assert.equal(digitsOnly('  0 3 ', 2), '03')
  assert.equal(digitsOnly('20144', 4), '2014')
  assert.equal(digitsOnly(null, 2), '')
})

test('the caret moves on only when a field is full', () => {
  // A `4` in the day box could still become `14`. Jumping out from under
  // someone mid-number costs more than the tap it saves.
  assert.equal(shouldAdvance('4', 2), false)
  assert.equal(shouldAdvance('14', 2), true)
  assert.equal(shouldAdvance('201', 4), false)
  assert.equal(shouldAdvance('2014', 4), true)
})

test('a partial date composes to nothing', () => {
  assert.equal(composeIso({ day: '14', month: '3', year: '201' }), null)
  assert.equal(composeIso({ day: '', month: '03', year: '2014' }), null)
  assert.equal(composeIso({ day: '14', month: '3', year: '2014' }), '2014-03-14')
})

test('an ISO date splits back into the fields it came from', () => {
  assert.deepEqual(splitIso('2014-03-14'), { day: '14', month: '03', year: '2014' })
  assert.deepEqual(splitIso('nonsense'), { day: '', month: '', year: '' })
})

// ── The verdict ───────────────────────────────────────────────────

test('an incomplete date is not an error', () => {
  // Shouting at someone who has typed two of eleven digits is how a form
  // teaches a child that it is angry at them.
  const v = ev('14', '', '')
  assert.equal(v.status, 'incomplete')
  assert.equal(v.message, '')
})

test('a real date is accepted and its age is echoed', () => {
  const v = ev('14', '03', '2014')
  assert.equal(v.status, 'ok')
  assert.equal(v.iso, '2014-03-14')
  assert.equal(v.age, 12)
  const echo = formatDobEcho(v.iso, v.age)
  assert.equal(echo.headline, 'That makes you 12 years old')
  assert.equal(echo.detail, '14 March 2014 — is that right?')
})

test('the echoed age is the age the consent gate will read', () => {
  // The whole value of the echo is that it is the same number. Computing it
  // with a second, friendlier date function is how the two drift.
  for (const iso of ['2014-03-14', '2008-08-19', '2008-08-20', '1990-01-01']) {
    const parts = splitIso(iso)
    assert.equal(ev(parts.day, parts.month, parts.year).age, ageInYears(iso, NOW))
  }
})

test('31 February is a typo, not a date in March', () => {
  const v = ev('31', '02', '2015')
  assert.equal(v.status, 'unreadable')
  assert.match(v.message, /day and month/)
  assert.equal(v.iso, null)
})

test('a future year says so instead of blaming the day', () => {
  const v = ev('01', '01', '2027')
  assert.equal(v.status, 'future')
  assert.match(v.message, /has not happened yet/)
})

test('an implausibly young age is refused as a typo', () => {
  const v = ev('01', '01', String(NOW.getUTCFullYear() - 2))
  assert.equal(v.status, 'too_young')
  assert.equal(v.age, 2)
  assert.match(v.message, /make you 2 years old/)
  assert.match(v.message, /check the year/i)
})

test('an implausibly old age is refused in the same words', () => {
  // Symmetry is the neutrality claim. Both ends read as "check the year";
  // neither reads as "you are not welcome here".
  const young = ev('01', '01', String(NOW.getUTCFullYear() - 2)).message
  const old = ev('01', '01', String(NOW.getUTCFullYear() - 120)).message
  assert.equal(ev('01', '01', String(NOW.getUTCFullYear() - 120)).status, 'too_old')
  const shape = (m) => m.replace(/\d+/g, 'N')
  assert.equal(shape(young), shape(old))
})

test('the plausibility window is inclusive at both ends', () => {
  const boundary = (age) => {
    const iso = `${NOW.getUTCFullYear() - age}-01-01`
    const p = splitIso(iso)
    return ev(p.day, p.month, p.year).status
  }
  assert.equal(boundary(MIN_PLAUSIBLE_AGE), 'ok')
  assert.equal(boundary(MIN_PLAUSIBLE_AGE - 1), 'too_young')
  assert.equal(boundary(MAX_PLAUSIBLE_AGE), 'ok')
  assert.equal(boundary(MAX_PLAUSIBLE_AGE + 1), 'too_old')
})

test('nothing in the plausible range is refused for being young', () => {
  // Routing by age is what the screen is for. Between the two typo bounds
  // every real date proceeds on identical terms.
  for (const age of [4, 9, 12, 17, 18, 45, 100]) {
    const iso = `${NOW.getUTCFullYear() - age}-01-01`
    const p = splitIso(iso)
    assert.equal(ev(p.day, p.month, p.year).status, 'ok', `age ${age} must proceed`)
  }
})

// ── Derived dates ─────────────────────────────────────────────────

test('a birth year derives the youngest date in it', () => {
  // 31 December is the conservative reading: it is the date that makes the
  // person youngest, and every derivation routes through it.
  assert.equal(dobForBirthYear(2014, NOW), '2014-12-31')
  assert.equal(dobForBirthYear(NOW.getUTCFullYear() + 1, NOW), null)
  assert.equal(dobForBirthYear('nonsense', NOW), null)
})

test('year-only gives a usable date', () => {
  const r = deriveDobFromYear('2014', ageInYears, NOW)
  assert.equal(r.iso, '2014-12-31')
  assert.equal(r.source, DOB_SOURCE.YEAR_ONLY)
  assert.equal(ageInYears(r.iso, NOW), 11)
})

test('year-only refuses a year it cannot use, with a reason', () => {
  const r = deriveDobFromYear('', ageInYears, NOW)
  assert.equal(r.iso, null)
  assert.match(r.message, /choose the year/i)
})

test('grade derives an age from the Zambian school ladder', () => {
  // Entry to Grade 1 at 7, one grade a year: Grade 7 is about 13, which is
  // the age of the learners the app is currently open to.
  assert.equal(typicalAgeForGrade(1), 7)
  assert.equal(typicalAgeForGrade(7), 13)
  assert.equal(typicalAgeForGrade(0), null)
  assert.equal(typicalAgeForGrade(13), null)
  const r = deriveDobFromGrade(7, ageInYears, NOW)
  assert.equal(r.source, DOB_SOURCE.GRADE)
  assert.equal(ageInYears(r.iso, NOW), 12)
})

test('every offered grade derives a date', () => {
  // A picker option that produces nothing is a dead end wearing a chevron.
  for (const g of GRADE_OPTIONS) {
    const r = deriveDobFromGrade(g, ageInYears, NOW)
    assert.ok(r.iso, `grade ${g} must derive a date`)
    assert.equal(r.message, '')
  }
})

test('an estimate anywhere near the consent age is recorded as a minor', () => {
  // THE RULE. A grade tells you an age to within about two years, so an
  // estimate of 18 is really "16 to 20" — and reading it as an adult hands a
  // child an unguarded account. Fail safe, not fail open.
  for (let age = GUARDIAN_CONSENT_AGE - BOUNDARY_BAND_YEARS; age <= GUARDIAN_CONSENT_AGE + BOUNDARY_BAND_YEARS; age++) {
    const raw = dobForBirthYear(NOW.getUTCFullYear() - age, NOW)
    const clamped = clampEstimateBelowConsentAge(raw, ageInYears, NOW)
    assert.ok(
      ageInYears(clamped, NOW) < GUARDIAN_CONSENT_AGE,
      `an estimate of ${age} must land under ${GUARDIAN_CONSENT_AGE}`,
    )
  }
})

test('every grade at or above the senior years still lands under the consent age', () => {
  for (const g of GRADE_OPTIONS) {
    const r = deriveDobFromGrade(g, ageInYears, NOW)
    assert.ok(
      ageInYears(r.iso, NOW) < GUARDIAN_CONSENT_AGE,
      `grade ${g} derives ${ageInYears(r.iso, NOW)}, which is not under ${GUARDIAN_CONSENT_AGE}`,
    )
  }
})

test('an estimate comfortably clear of the boundary is left alone', () => {
  // The clamp is for the band, not a blanket "everyone is a child" rule —
  // that would put every adult through a guardian screen they cannot answer.
  const adult = dobForBirthYear(NOW.getUTCFullYear() - 40, NOW)
  assert.equal(clampEstimateBelowConsentAge(adult, ageInYears, NOW), adult)
  const child = dobForBirthYear(NOW.getUTCFullYear() - 10, NOW)
  assert.equal(clampEstimateBelowConsentAge(child, ageInYears, NOW), child)
})

test('a typed date is never clamped', () => {
  // The learner confirmed an echoed age. Quietly recording a different one
  // would make that confirmation a lie, and support could never explain it.
  const v = ev('19', '08', String(NOW.getUTCFullYear() - 18))
  assert.equal(v.status, 'ok')
  assert.equal(v.age, 18)
  assert.equal(v.iso, `${NOW.getUTCFullYear() - 18}-08-19`)
})

// ── Options + provenance ──────────────────────────────────────────

test('the year picker does not open on an adult date', () => {
  const years = birthYearOptions(NOW)
  assert.equal(years[0], NOW.getUTCFullYear() - MIN_PLAUSIBLE_AGE)
  assert.equal(years[years.length - 1], NOW.getUTCFullYear() - MAX_PLAUSIBLE_AGE)
  assert.ok(NOW.getUTCFullYear() - years[0] < GUARDIAN_CONSENT_AGE)
})

test('only the three known provenances are accepted', () => {
  for (const s of Object.values(DOB_SOURCE)) assert.equal(isKnownDobSource(s), true)
  assert.equal(isKnownDobSource('guessed'), false)
  assert.equal(isKnownDobSource(undefined), false)
})

test('a long date reads the way a child would say it', () => {
  assert.equal(formatLongDate('2014-03-14'), '14 March 2014')
  assert.equal(formatLongDate('2014-13-01'), '')
})

// ── Report ────────────────────────────────────────────────────────

console.log('')
console.log(`─── ${pass + failures.length} tests · ${pass} passed · ${failures.length} failed ───`)
if (failures.length) {
  console.log('\nfailures:')
  failures.forEach(f => console.log(`  × ${f.name}\n    ${f.message}`))
  process.exit(1)
}
