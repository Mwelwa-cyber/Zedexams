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
 * The guardian capture that used to live on this screen moved to
 * GuardianConsentStep, after the account exists — see that spec.
 */

const recordAgeGateAttempt = vi.fn()
vi.mock('../../utils/ageGateService', () => ({
  recordAgeGateAttempt: (...a) => recordAgeGateAttempt(...a),
  sendGuardianConsentRequest: vi.fn(),
  getDeviceId: () => 'device-test',
}))

import AgeGateStep from './AgeGateStep'

const onAnswer = vi.fn()

function setup(props = {}) {
  return render(<AgeGateStep onAnswer={onAnswer} {...props} />)
}

function enterDob({ day, month, year }) {
  fireEvent.change(screen.getByLabelText(/^day$/i), { target: { value: String(day) } })
  fireEvent.change(screen.getByLabelText(/^month$/i), { target: { value: String(month) } })
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: String(year) } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  recordAgeGateAttempt.mockResolvedValue({ blocked: false })
})

describe('AgeGateStep — neutrality', () => {
  it('asks the question and explains nothing about the consequences', () => {
    setup()
    expect(screen.getByText(/when were you born/i)).toBeInTheDocument()
    // The failure this guards: a well-meaning hint that teaches the user
    // which answer gets them the bigger app.
    const text = document.body.textContent
    expect(text).not.toMatch(/parent|guardian|approve|under 1[38]|adult|age/i)
  })

  it('gives a reason for asking that reveals nothing', () => {
    setup()
    expect(screen.getByText(/helps us set zedexams up right for you/i)).toBeInTheDocument()
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
    for (const label of [/^day$/i, /^month$/i, /^year$/i]) {
      expect(screen.getByLabelText(label).value).toBe('')
    }
  })

  it('does not offer an adult year as the first option', () => {
    setup()
    const options = [...screen.getByLabelText(/^year$/i).querySelectorAll('option')]
    expect(options[0].value).toBe('')
    // Years run newest-first, so the first real option is this year — not a
    // date that would route straight past the guardian step.
    expect(Number(options[1].value)).toBe(new Date().getFullYear())
  })
})

describe('AgeGateStep — the answer', () => {
  it('hands back a real date', async () => {
    setup()
    enterDob({ day: 1, month: 0, year: 1990 })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ dob: '1990-01-01' }))
  })

  it('hands back a child date on exactly the same terms', async () => {
    // Routing by age happens in the flow, not here. This screen must not
    // behave differently for a younger answer — behaving differently is how a
    // user learns what the screen is for.
    setup()
    enterDob({ day: 3, month: 5, year: 2015 })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ dob: '2015-06-03' }))
  })

  it('rejects an impossible date instead of inventing an age', async () => {
    // new Date('2015-02-31') rolls into March. A rolled date is a typo, and
    // treating it as real assigns an age nobody entered.
    setup()
    enterDob({ day: 31, month: 1, year: 2015 })
    await waitFor(() =>
      expect(screen.getByText(/doesn't look right/i)).toBeInTheDocument(),
    )
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('rejects a date in the future', async () => {
    setup()
    const next = new Date().getFullYear() + 1
    // The year list only runs backwards, so a future year has to be forced in
    // — which is exactly what a tampered client would do.
    const yearSelect = screen.getByLabelText(/^year$/i)
    const option = document.createElement('option')
    option.value = String(next)
    yearSelect.appendChild(option)
    enterDob({ day: 1, month: 0, year: next })
    await waitFor(() =>
      expect(screen.getByText(/doesn't look right/i)).toBeInTheDocument(),
    )
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('will not continue on a partial date', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2015' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() =>
      expect(screen.getByText(/choose the day, month and year/i)).toBeInTheDocument(),
    )
    expect(onAnswer).not.toHaveBeenCalled()
  })
})

describe('AgeGateStep — the locked first answer', () => {
  it('shows the first answer, read-only, on a return visit', async () => {
    // Criterion 5: backing out and coming back must not be a way to try a
    // different birthday.
    setup({ lockedDob: '2015-06-03' })
    expect(screen.getByLabelText(/^day$/i).value).toBe('3')
    expect(screen.getByLabelText(/^month$/i).value).toBe('5')
    expect(screen.getByLabelText(/^year$/i).value).toBe('2015')
    for (const label of [/^day$/i, /^month$/i, /^year$/i]) {
      expect(screen.getByLabelText(label)).toBeDisabled()
    }
  })

  it('confirms the locked answer without re-running the cooldown', async () => {
    // Re-reporting it would block the user with their own previous answer.
    setup({ lockedDob: '2015-06-03' })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith({ dob: '2015-06-03' }))
    expect(recordAgeGateAttempt).not.toHaveBeenCalled()
  })
})

describe('AgeGateStep — retry cooldown', () => {
  it('reports the attempt to the server', async () => {
    setup()
    enterDob({ day: 1, month: 0, year: 1990 })
    await waitFor(() => expect(recordAgeGateAttempt).toHaveBeenCalled())
  })

  it('honours a server block instead of routing', async () => {
    recordAgeGateAttempt.mockResolvedValue({ blocked: true })
    setup()
    enterDob({ day: 1, month: 0, year: 1990 })
    await waitFor(() =>
      expect(screen.getByText(/already answered this today/i)).toBeInTheDocument(),
    )
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('still lets a real person sign up when the cooldown check fails', async () => {
    // Fail open: this is an anti-retry speed bump, not an authorisation
    // check, and an outage must not block signup entirely.
    recordAgeGateAttempt.mockRejectedValue(new Error('offline'))
    setup()
    enterDob({ day: 1, month: 0, year: 1990 })
    await waitFor(() => expect(onAnswer).toHaveBeenCalled())
  })
})
