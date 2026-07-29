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
 */

const recordAgeGateAttempt = vi.fn()
vi.mock('../../utils/ageGateService', () => ({
  recordAgeGateAttempt: (...a) => recordAgeGateAttempt(...a),
  sendGuardianConsentRequest: vi.fn(),
  getDeviceId: () => 'device-test',
}))

import AgeGateStep from './AgeGateStep'

const onAdult = vi.fn()
const onChild = vi.fn()

function setup() {
  return render(<AgeGateStep onAdult={onAdult} onChild={onChild} />)
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

describe('AgeGateStep — routing', () => {
  it('routes an adult straight through', async () => {
    setup()
    enterDob({ day: 1, month: 0, year: 1990 })
    await waitFor(() => expect(onAdult).toHaveBeenCalledWith({ dob: '1990-01-01' }))
    expect(onChild).not.toHaveBeenCalled()
  })

  it('routes a child to the guardian step', async () => {
    setup()
    enterDob({ day: 3, month: 5, year: 2015 })
    await waitFor(() =>
      expect(screen.getByLabelText(/parent or guardian's email/i)).toBeInTheDocument(),
    )
    expect(onAdult).not.toHaveBeenCalled()
  })

  it('treats someone one day short of 18 as a child', async () => {
    // The boundary is where an off-by-one silently routes a 17-year-old into
    // the adult flow, which is the exact failure the gate exists to prevent.
    const tomorrow = new Date()
    tomorrow.setFullYear(tomorrow.getFullYear() - 18)
    tomorrow.setDate(tomorrow.getDate() + 1)
    setup()
    enterDob({
      day: tomorrow.getDate(),
      month: tomorrow.getMonth(),
      year: tomorrow.getFullYear(),
    })
    await waitFor(() =>
      expect(screen.getByLabelText(/parent or guardian's email/i)).toBeInTheDocument(),
    )
  })

  it('rejects an impossible date instead of inventing an age', async () => {
    // new Date('2015-02-31') rolls into March. A rolled date is a typo, and
    // treating it as real assigns an age nobody entered.
    setup()
    enterDob({ day: 31, month: 1, year: 2015 })
    await waitFor(() =>
      expect(screen.getByText(/doesn't look right/i)).toBeInTheDocument(),
    )
    expect(onAdult).not.toHaveBeenCalled()
    expect(onChild).not.toHaveBeenCalled()
  })

  it('will not continue on a partial date', async () => {
    setup()
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2015' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() =>
      expect(screen.getByText(/choose the day, month and year/i)).toBeInTheDocument(),
    )
    expect(onChild).not.toHaveBeenCalled()
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
    expect(onAdult).not.toHaveBeenCalled()
  })

  it('still lets a real person sign up when the cooldown check fails', async () => {
    // Fail open: this is an anti-retry speed bump, not an authorisation
    // check, and an outage must not block signup entirely.
    recordAgeGateAttempt.mockRejectedValue(new Error('offline'))
    setup()
    enterDob({ day: 1, month: 0, year: 1990 })
    await waitFor(() => expect(onAdult).toHaveBeenCalled())
  })
})

describe('AgeGateStep — guardian capture', () => {
  async function reachGuardianStep() {
    setup()
    enterDob({ day: 3, month: 5, year: 2015 })
    await waitFor(() =>
      expect(screen.getByLabelText(/parent or guardian's email/i)).toBeInTheDocument(),
    )
  }

  it('hands back the contact, method and a pending status', async () => {
    await reachGuardianStep()
    fireEvent.change(screen.getByLabelText(/parent or guardian's email/i), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onChild).toHaveBeenCalledWith({
      dob: '2015-06-03',
      guardian: { contact: 'parent@example.com', method: 'email', consentStatus: 'pending' },
    })
  })

  it('accepts a WhatsApp number when that method is chosen', async () => {
    await reachGuardianStep()
    fireEvent.click(screen.getByRole('button', { name: /^whatsapp$/i }))
    fireEvent.change(screen.getByLabelText(/parent or guardian's whatsapp/i), {
      target: { value: '+260 97 1234567' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    expect(onChild).toHaveBeenCalledWith(expect.objectContaining({
      guardian: expect.objectContaining({ method: 'whatsapp' }),
    }))
  })

  it('will not continue without a usable contact', async () => {
    await reachGuardianStep()
    fireEvent.change(screen.getByLabelText(/parent or guardian's email/i), {
      target: { value: 'not-an-email' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    await waitFor(() =>
      expect(screen.getByText(/enter your parent or guardian's email/i)).toBeInTheDocument(),
    )
    expect(onChild).not.toHaveBeenCalled()
  })

  it('offers no way back to the date screen', async () => {
    // Going back to change the answer is retry-with-an-older-age wearing a
    // different hat, and it would sidestep the server cooldown entirely.
    await reachGuardianStep()
    expect(screen.queryByRole('button', { name: /back|change|previous/i })).toBeNull()
    expect(screen.queryByLabelText(/^year$/i)).toBeNull()
  })
})
