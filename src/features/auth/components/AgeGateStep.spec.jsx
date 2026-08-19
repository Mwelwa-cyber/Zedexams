import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * AgeGateStep — the neutral age screen.
 *
 * "Neutral" is a specific claim Play asks us to make in the Console, and it
 * is the kind of claim that quietly stops being true: someone adds a helpful
 * "under 13? your parent will need to approve" line, or pre-selects a year to
 * save a tap, and the screen becomes a quiz with the answer on the back.
 * These tests are what makes the declaration checkable.
 *
 * The date RULES — plausibility, the age echoed back, every derivation
 * landing under the consent age — are pure and tested under plain node in
 * scripts/test-age-answer.mjs. What is tested here is what only a DOM can
 * answer: that the keyboard reaches every field, that Continue stays shut
 * until the age has been read back, and that no route out of "I'm not sure"
 * ends in a screen the learner cannot leave.
 *
 * The guardian capture that used to live on this screen moved to
 * GuardianConsentStep, after the account exists — see that spec.
 */

const recordAgeGateAttempt = vi.fn()
vi.mock('../../../utils/ageGateService', () => ({
  recordAgeGateAttempt: (...a) => recordAgeGateAttempt(...a),
  sendGuardianConsentRequest: vi.fn(),
  getDeviceId: () => 'device-test',
}))

import AgeGateStep from './AgeGateStep'

const onAnswer = vi.fn()

function setup(props = {}) {
  return render(<AgeGateStep onAnswer={onAnswer} {...props} />)
}

const field = (name) => screen.getByLabelText(new RegExp(`^${name}$`, 'i'))

/** Type a date the way a thumb does — one field at a time, digits only. */
function typeDob({ day, month, year }) {
  fireEvent.change(field('day'), { target: { value: String(day) } })
  fireEvent.change(field('month'), { target: { value: String(month) } })
  fireEvent.change(field('year'), { target: { value: String(year) } })
}

const continueButton = () => screen.getByRole('button', { name: /^continue$/i })

/** This year, so the fixtures age with the calendar instead of rotting. */
const THIS_YEAR = new Date().getUTCFullYear()

beforeEach(() => {
  vi.clearAllMocks()
  recordAgeGateAttempt.mockResolvedValue({ blocked: false })
})

describe('AgeGateStep — neutrality', () => {
  it('asks the question and explains nothing about the consequences', () => {
    setup()
    expect(screen.getByText(/when were you born/i)).toBeInTheDocument()
    // The failure this guards: a well-meaning hint that teaches the user
    // which answer gets them the bigger app. "grown-up" is allowed and the
    // privacy line uses it — what is not allowed is any statement about what
    // an ANSWER leads to.
    const text = document.body.textContent
    expect(text).not.toMatch(/approve|under 1[38]|too young|adult|permission/i)
  })

  it('gives a reason for asking that reveals nothing', () => {
    setup()
    expect(screen.getByText(/set up the right account for you/i)).toBeInTheDocument()
  })

  it('carries no sign-up method of its own', () => {
    // The structural rule: both auth methods live on a screen that comes
    // AFTER this one. A Google button here would be the bypass all over again.
    setup()
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(screen.queryByLabelText(/email/i)).toBeNull()
  })

  it('pre-fills nothing', () => {
    setup()
    for (const name of ['day', 'month', 'year']) {
      expect(field(name).value).toBe('')
    }
  })

  it('refuses both ends of the plausible range in the same words', () => {
    // Symmetry IS the neutrality. A gentler refusal for a young answer is a
    // hint about which end of the range is welcome.
    setup()
    typeDob({ day: '01', month: '01', year: String(THIS_YEAR - 2) })
    const young = screen.getByRole('alert').textContent
    typeDob({ day: '01', month: '01', year: String(THIS_YEAR - 120) })
    const old = screen.getByRole('alert').textContent
    const shape = (s) => s.replace(/\d+/g, 'N')
    expect(shape(young)).toBe(shape(old))
    expect(young).toMatch(/check the year/i)
  })
})

describe('AgeGateStep — typing the date', () => {
  it('offers three numeric fields, not three dropdowns', () => {
    // The whole point of the redesign: one keyboard instead of three modal
    // pickers and a year list a child born in 2014 has to scroll down.
    setup()
    for (const [name, len] of [['day', '2'], ['month', '2'], ['year', '4']]) {
      const el = field(name)
      expect(el.tagName).toBe('INPUT')
      expect(el.getAttribute('inputmode')).toBe('numeric')
      expect(el.getAttribute('maxlength')).toBe(len)
    }
  })

  it('moves the caret on when a field is full', () => {
    setup()
    fireEvent.change(field('day'), { target: { value: '14' } })
    expect(document.activeElement).toBe(field('month'))
    fireEvent.change(field('month'), { target: { value: '03' } })
    expect(document.activeElement).toBe(field('year'))
  })

  it('does not move the caret while a field could still grow', () => {
    // A `4` in the day box might yet become `14`. Jumping out from under
    // someone mid-number costs more than the tap it saves.
    setup()
    const day = field('day')
    day.focus()
    fireEvent.change(day, { target: { value: '4' } })
    expect(document.activeElement).toBe(day)
  })

  it('backspacing out of an empty field steps back', () => {
    // Without this the auto-advance is a one-way door and a correction needs
    // a tap the keyboard is covering.
    setup()
    typeDob({ day: '14', month: '03', year: '' })
    const year = field('year')
    year.focus()
    fireEvent.keyDown(year, { key: 'Backspace' })
    expect(document.activeElement).toBe(field('month'))
  })

  it('keeps digits and drops everything else', () => {
    setup()
    fireEvent.change(field('year'), { target: { value: '2o14x' } })
    expect(field('year').value).toBe('214')
  })
})

describe('AgeGateStep — the age echo', () => {
  it('reads the age back before Continue is available', () => {
    // THE headline change. A child who types 2004 for 2014 reads "22 years
    // old" and fixes it — which is the exact typo that would otherwise drop a
    // twelve-year-old into an adult account with no guardian.
    setup()
    expect(continueButton()).toBeDisabled()
    typeDob({ day: '14', month: '03', year: '2014' })
    expect(screen.getByRole('status')).toHaveTextContent(/that makes you \d+ years old/i)
    expect(screen.getByRole('status')).toHaveTextContent(/14 March 2014 — is that right\?/i)
    expect(continueButton()).toBeEnabled()
  })

  it('shows nothing at all while the date is half-typed', () => {
    // Shouting at someone who has typed two of eight digits is how a form
    // teaches a child that it is angry at them.
    setup()
    typeDob({ day: '14', month: '', year: '' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(continueButton()).toBeDisabled()
  })

  it('blocks Continue on an impossible date and says which part is wrong', () => {
    // new Date('2015-02-31') rolls into March. A rolled date is a typo, and
    // treating it as real assigns an age nobody entered.
    setup()
    typeDob({ day: '31', month: '02', year: '2015' })
    expect(screen.getByRole('alert')).toHaveTextContent(/day and month/i)
    expect(screen.queryByRole('status')).toBeNull()
    expect(continueButton()).toBeDisabled()
  })

  it('blames the year, not the day, when the year has not happened', () => {
    setup()
    typeDob({ day: '01', month: '01', year: String(THIS_YEAR + 1) })
    expect(screen.getByRole('alert')).toHaveTextContent(/has not happened yet/i)
    expect(continueButton()).toBeDisabled()
  })

  it('hands back the confirmed date', async () => {
    setup()
    typeDob({ day: '01', month: '01', year: '1990' })
    fireEvent.click(continueButton())
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({ dob: '1990-01-01', dobSource: 'typed' }))
  })

  it('hands back a child date on exactly the same terms', async () => {
    // Routing by age happens in the flow, not here. This screen must not
    // behave differently for a younger answer — behaving differently is how a
    // user learns what the screen is for.
    setup()
    typeDob({ day: '03', month: '06', year: '2015' })
    fireEvent.click(continueButton())
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({ dob: '2015-06-03', dobSource: 'typed' }))
  })
})

describe('AgeGateStep — "I\'m not sure of my birthday"', () => {
  const notSure = () => screen.getByRole('button', { name: /not sure of my birthday/i })

  it('is offered, because a required three-field form stops a child who does not know', () => {
    setup()
    expect(notSure()).toBeInTheDocument()
  })

  it('offers three ways out and a way back', () => {
    setup()
    fireEvent.click(notSure())
    expect(screen.getByRole('button', { name: /know the year only/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /know my grade/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ask my grown-up/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /go back and type it/i }))
    expect(screen.getByText(/when were you born/i)).toBeInTheDocument()
  })

  it('resolves the year-only route to a date', async () => {
    setup()
    fireEvent.click(notSure())
    fireEvent.click(screen.getByRole('button', { name: /know the year only/i }))
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2014' } })
    fireEvent.click(continueButton())
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({ dob: '2014-12-31', dobSource: 'year_only' }))
  })

  it('resolves the grade route to a date, after showing the estimate', async () => {
    setup()
    fireEvent.click(notSure())
    fireEvent.click(screen.getByRole('button', { name: /know my grade/i }))
    fireEvent.change(screen.getByLabelText(/^grade$/i), { target: { value: '7' } })
    // Hedged on purpose: it IS a guess, and presenting it as a fact invites a
    // correction the learner has no way to make.
    expect(screen.getByText(/about 13 years old/i)).toBeInTheDocument()
    fireEvent.click(continueButton())
    await waitFor(() => expect(onAnswer).toHaveBeenCalled())
    expect(onAnswer.mock.calls[0][0].dobSource).toBe('grade')
  })

  it('never leaves the grown-up route without a way forward', () => {
    // "Not a dead end" has to mean the screen a child lands on can be left.
    setup()
    fireEvent.click(notSure())
    fireEvent.click(screen.getByRole('button', { name: /ask my grown-up/i }))
    fireEvent.click(screen.getByRole('button', { name: /type it now/i }))
    expect(screen.getByText(/when were you born/i)).toBeInTheDocument()
  })

  it('offers no year a four-year-old could not have', () => {
    setup()
    fireEvent.click(notSure())
    fireEvent.click(screen.getByRole('button', { name: /know the year only/i }))
    const options = [...screen.getByLabelText(/^year$/i).querySelectorAll('option')]
    expect(options[0].value).toBe('')
    // Newest first, so the first real option is never an adult date.
    expect(Number(options[1].value)).toBe(THIS_YEAR - 4)
  })
})

describe('AgeGateStep — the locked first answer', () => {
  it('shows the first answer, read-only, on a return visit', () => {
    // Criterion 5: backing out and coming back must not be a way to try a
    // different birthday.
    setup({ lockedDob: '2015-06-03' })
    expect(field('day').value).toBe('03')
    expect(field('month').value).toBe('06')
    expect(field('year').value).toBe('2015')
    for (const name of ['day', 'month', 'year']) {
      expect(field(name)).toBeDisabled()
    }
  })

  it('hides the escape hatch once an answer is locked', () => {
    // "I'm not sure" is a way to ANSWER, not a way to answer again.
    setup({ lockedDob: '2015-06-03' })
    expect(screen.queryByRole('button', { name: /not sure of my birthday/i })).toBeNull()
  })

  it('confirms the locked answer without re-running the cooldown', async () => {
    // Re-reporting it would block the user with their own previous answer.
    setup({ lockedDob: '2015-06-03' })
    fireEvent.click(continueButton())
    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith({ dob: '2015-06-03', dobSource: 'typed' }))
    expect(recordAgeGateAttempt).not.toHaveBeenCalled()
  })
})

describe('AgeGateStep — retry cooldown', () => {
  it('reports the attempt to the server', async () => {
    setup()
    typeDob({ day: '01', month: '01', year: '1990' })
    fireEvent.click(continueButton())
    await waitFor(() => expect(recordAgeGateAttempt).toHaveBeenCalled())
  })

  it('reports the derived routes too', async () => {
    // A route that skipped the cooldown would be a retry with extra steps —
    // exactly the thing the lock exists to stop, hidden behind a friendlier
    // screen.
    setup()
    fireEvent.click(screen.getByRole('button', { name: /not sure of my birthday/i }))
    fireEvent.click(screen.getByRole('button', { name: /know the year only/i }))
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2014' } })
    fireEvent.click(continueButton())
    await waitFor(() => expect(recordAgeGateAttempt).toHaveBeenCalled())
  })

  it('honours a server block instead of routing', async () => {
    recordAgeGateAttempt.mockResolvedValue({ blocked: true })
    setup()
    typeDob({ day: '01', month: '01', year: '1990' })
    fireEvent.click(continueButton())
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/already answered this today/i))
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('still lets a real person sign up when the cooldown check fails', async () => {
    // Fail open: this is an anti-retry speed bump, not an authorisation
    // check, and an outage must not block signup entirely.
    recordAgeGateAttempt.mockRejectedValue(new Error('offline'))
    setup()
    typeDob({ day: '01', month: '01', year: '1990' })
    fireEvent.click(continueButton())
    await waitFor(() => expect(onAnswer).toHaveBeenCalled())
  })
})
