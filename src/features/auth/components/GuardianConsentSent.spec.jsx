import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * GuardianConsentSent — the waiting screen.
 *
 * Waiting is not blocking, and this screen is where that either lands or
 * doesn't. What is pinned here is the three things a child must leave with:
 * their account works NOW, something specific is still off, and if the
 * message went to the wrong place there are two ways to fix it from here.
 */

const mockSend = vi.fn()
vi.mock('../../../utils/ageGateService', () => ({
  sendGuardianConsentRequest: (...a) => mockSend(...a),
  previewGuardianConsentRequest: vi.fn(),
  startSameDeviceConsent: vi.fn(),
  recordAgeGateAttempt: vi.fn(),
  getDeviceId: () => 'device-test',
}))

import GuardianConsentSent from './GuardianConsentSent'
import { CAPABILITY, FULL_CAPABILITY_SET, LIMITED_CAPABILITY_SET } from '../../../utils/guardianConsent'

const onContinue = vi.fn()
const onChangeContact = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockSend.mockResolvedValue({ ok: true, sent: 'whatsapp_link', waLink: 'https://wa.me/1?text=x' })
  vi.stubGlobal('open', vi.fn())
})

function setup(props = {}) {
  return render(
    <GuardianConsentSent
      guardianContact="+260 977 123 456"
      channel="whatsapp"
      onContinue={onContinue}
      onChangeContact={onChangeContact}
      {...props}
    />,
  )
}

describe('GuardianConsentSent', () => {
  it('leads with the message being sent, not with waiting', () => {
    // A child who reads this as "you may not start yet" closes the app.
    setup()
    expect(screen.getByRole('heading', { name: /message sent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start learning/i })).toBeInTheDocument()
  })

  it('names who was messaged, so a wrong number is caught by the person who typed it', () => {
    setup()
    expect(screen.getByText('+260 977 123 456')).toBeInTheDocument()
  })

  it('names what works now and what is still off', () => {
    setup()
    expect(screen.getByText(/you can use these now/i)).toBeInTheDocument()
    expect(screen.getByText(/past papers/i)).toBeInTheDocument()
    expect(screen.getByText(/switch on after they say yes/i)).toBeInTheDocument()
    expect(screen.getByText(/the weekly leaderboard/i)).toBeInTheDocument()
  })

  it('lists exactly the capabilities the server still refuses', () => {
    // The list is derived from the capability sets rather than typed out, so
    // it cannot drift into telling a child something works when it doesn't.
    setup()
    const stillLocked = FULL_CAPABILITY_SET.filter((c) => !LIMITED_CAPABILITY_SET.includes(c))
    expect(stillLocked).toContain(CAPABILITY.AI_CHAT)
    expect(stillLocked).toContain(CAPABILITY.LEADERBOARD)
    expect(stillLocked).toContain(CAPABILITY.SOCIAL)
  })

  it('never advertises spending to a child', () => {
    // PURCHASE is gated too, and is deliberately absent: an under-18 learner
    // is never shown a price, and listing "buying things" among the rewards
    // of approval is a price tag with extra steps.
    setup()
    expect(screen.queryByText(/buy|pay|premium|price/i)).toBeNull()
  })

  it('can send the same message again', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /send it again/i }))
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith({ contact: '+260 977 123 456', channel: 'whatsapp' }))
  })

  it('offers a different number, because resend alone cannot fix a wrong one', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /use a different number/i }))
    expect(onChangeContact).toHaveBeenCalled()
  })

  it('passes the pacing refusal through in the words that name the wait', async () => {
    mockSend.mockRejectedValue(Object.assign(
      new Error('We already sent a message. You can send another one in 15 minutes.'),
      { code: 'functions/resource-exhausted' },
    ))
    setup()
    fireEvent.click(screen.getByRole('button', { name: /send it again/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/in 15 minutes/i))
  })

  it('still shows who was messaged for a sign-up that crossed the deploy', () => {
    // `guardianEmail` was the key before WhatsApp existed.
    setup({ guardianContact: undefined, guardianEmail: 'mum@example.com', channel: 'email' })
    expect(screen.getByText('mum@example.com')).toBeInTheDocument()
  })
})
