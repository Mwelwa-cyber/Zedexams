import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * GuardianConsentStep — the hand-off, after the account exists.
 *
 * The behaviour worth pinning is not the form. It is:
 *
 *   • NOTHING here can cost the learner their account. A bad number, a failed
 *     send, a closed app and an outright skip all leave a working
 *     limited-mode account behind. The moment that stops being true, the flow
 *     starts deleting children's accounts because a parent's inbox was full.
 *
 *   • WhatsApp is what a Zambian guardian is reached on, so it is what the
 *     screen offers first. This is the change that moves the funnel.
 *
 *   • Nothing is sent before the child has seen it. The confirm screen shows
 *     the REAL outbound message, because a mistyped digit is otherwise
 *     invisible to everyone.
 *
 *   • No exit is a dead end — not "I have no grown-up's number", not a
 *     refused send, not a network failure.
 */

const mockSend = vi.fn()
const mockPreview = vi.fn()
const mockSameDevice = vi.fn()
vi.mock('../../../utils/ageGateService', () => ({
  sendGuardianConsentRequest: (...a) => mockSend(...a),
  previewGuardianConsentRequest: (...a) => mockPreview(...a),
  startSameDeviceConsent: (...a) => mockSameDevice(...a),
  recordAgeGateAttempt: vi.fn(),
  getDeviceId: () => 'device-test',
}))

import GuardianConsentStep from './GuardianConsentStep'

const onSent = vi.fn()
const onSkip = vi.fn()

const PREVIEW = {
  ok: true,
  dryRun: true,
  channel: 'whatsapp',
  contactDisplay: '+260 977 123 456',
  allowed: true,
  preview: {
    subject: '',
    body: 'Hello! Lydia created a learner account on ZedExams.\n\nApprove: zedexams.com/consent/·····',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPreview.mockResolvedValue(PREVIEW)
  mockSend.mockResolvedValue({ ok: true, sent: 'whatsapp_link', waLink: 'https://wa.me/260977123456?text=x' })
  mockSameDevice.mockResolvedValue({ ok: true, consentUrl: 'https://zedexams.com/consent?token=abc' })
  vi.stubGlobal('open', vi.fn())
})

function setup(props = {}) {
  return render(<GuardianConsentStep onSent={onSent} onSkip={onSkip} childName="Lydia" {...props} />)
}

async function typeContactAndContinue(value = '0977123456') {
  fireEvent.change(screen.getByLabelText(/their phone number/i), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: /send the message/i }))
}

describe('GuardianConsentStep — asking', () => {
  it('offers WhatsApp first, because that is what a guardian actually checks', () => {
    setup()
    expect(screen.getByRole('button', { name: /whatsapp/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /email/i })).toHaveAttribute('aria-pressed', 'false')
    // And the field asks for the thing the default channel needs.
    expect(screen.getByLabelText(/their phone number/i)).toBeInTheDocument()
  })

  it('switches the field when the child picks email', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /email/i }))
    expect(screen.getByLabelText(/their email address/i)).toBeInTheDocument()
  })

  it('says what the contact is used for, next to the field', () => {
    setup()
    expect(screen.getByText(/only use this to ask permission/i)).toBeInTheDocument()
    expect(screen.getByText(/never sell it or send adverts/i)).toBeInTheDocument()
  })

  it('tells the learner they can start now', () => {
    setup()
    expect(screen.getByText(/start learning while you wait/i)).toBeInTheDocument()
  })

  it('refuses a number that cannot be one, without a round trip', async () => {
    setup()
    await typeContactAndContinue('12345')
    await waitFor(() =>
      expect(screen.getByText(/doesn't look like a phone number/i)).toBeInTheDocument())
    expect(mockPreview).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('never offers to delete or abandon the account', () => {
    setup()
    expect(screen.queryByRole('button', { name: /cancel|delete|start over/i })).toBeNull()
  })

  it('can be skipped', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /i'll do this later/i }))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('GuardianConsentStep — confirming before sending', () => {
  it('shows the number back and the real message, and sends nothing yet', async () => {
    setup()
    await typeContactAndContinue()
    await waitFor(() => expect(screen.getByText(/check this is right/i)).toBeInTheDocument())

    // Grouped, so a wrong digit in a run of twelve is visible.
    expect(screen.getByText('+260 977 123 456')).toBeInTheDocument()
    expect(screen.getByTestId('guardian-message-preview')).toHaveTextContent(
      /Lydia created a learner account/i)
    expect(mockPreview).toHaveBeenCalledWith({ contact: '0977123456', channel: 'whatsapp' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends only once the child confirms', async () => {
    setup()
    await typeContactAndContinue()
    await waitFor(() => screen.getByRole('button', { name: /yes, send it/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }))

    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith({ contact: '0977123456', channel: 'whatsapp' }))
    // WhatsApp cannot be sent from our side to someone who never messaged us
    // (Meta's 24-hour window), so the composer opens on this device.
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('wa.me'), '_blank', 'noopener')
    expect(onSent).toHaveBeenCalledWith({ guardianContact: '+260 977 123 456', channel: 'whatsapp' })
  })

  it('lets the child go back and fix the number', async () => {
    setup()
    await typeContactAndContinue()
    await waitFor(() => screen.getByRole('button', { name: /change the number/i }))
    fireEvent.click(screen.getByRole('button', { name: /change the number/i }))
    expect(screen.getByLabelText(/their phone number/i)).toBeInTheDocument()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('reports the server\'s refusal in the server\'s words', async () => {
    // Their own contact, a contact that already learns here, the send ladder:
    // the server is the side that knows which, so its sentence is the one the
    // child reads.
    mockPreview.mockRejectedValue(Object.assign(new Error(
      'This is your own contact. Use a grown-up\'s one.'), { code: 'functions/invalid-argument' }))
    setup()
    await typeContactAndContinue()
    await waitFor(() => expect(screen.getByText(/this is your own contact/i)).toBeInTheDocument())
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('says when the next message may go, instead of just refusing', async () => {
    mockPreview.mockResolvedValue({
      ...PREVIEW, allowed: false,
      refusal: 'We already sent a message. You can send another one in 15 minutes.',
    })
    setup()
    await typeContactAndContinue()
    await waitFor(() => expect(screen.getByText(/in 15 minutes/i)).toBeInTheDocument())
  })

  it('keeps the learner moving when the send fails', async () => {
    // The account exists. A failed send is a message to retry, not a dead end.
    mockSend.mockRejectedValue(new Error('smtp down'))
    setup()
    await typeContactAndContinue()
    await waitFor(() => screen.getByRole('button', { name: /yes, send it/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }))
    await waitFor(() =>
      expect(screen.getByText(/try again from your dashboard/i)).toBeInTheDocument())
    expect(onSent).not.toHaveBeenCalled()
  })
})

describe('GuardianConsentStep — the grown-up in the room', () => {
  it('offers the hand-over on the asking screen, not as a fallback', () => {
    setup()
    expect(screen.getByText(/is your grown-up here right now/i)).toBeInTheDocument()
  })

  it('lands on the same consent page the emailed link opens', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign }, writable: true, configurable: true,
    })
    setup()
    fireEvent.click(screen.getByText(/is your grown-up here right now/i))
    await waitFor(() => screen.getByRole('heading', { name: /pass the phone/i }))
    fireEvent.click(screen.getByRole('button', { name: /i'm the grown-up/i }))

    await waitFor(() => expect(mockSameDevice).toHaveBeenCalled())
    // A full navigation to the server-rendered page — not a route change, and
    // not a second consent screen of our own that would write a different
    // record.
    expect(assign).toHaveBeenCalledWith('https://zedexams.com/consent?token=abc')
  })

  it('goes back to messaging when they are not here after all', async () => {
    setup()
    fireEvent.click(screen.getByText(/is your grown-up here right now/i))
    await waitFor(() => screen.getByRole('button', { name: /not here — send a message/i }))
    fireEvent.click(screen.getByRole('button', { name: /not here — send a message/i }))
    expect(screen.getByLabelText(/their phone number/i)).toBeInTheDocument()
  })
})

describe('GuardianConsentStep — no grown-up to name', () => {
  it('routes to a person, never to a blocked state', async () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /tell us and we'll help/i }))
    await waitFor(() => screen.getByRole('heading', { name: /we'll help you sort this out/i }))

    // Three live exits: a ticket, WhatsApp, email — plus lessons.
    expect(screen.getByRole('button', { name: /send us a message/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /whatsapp us/i })).toHaveAttribute(
      'href', 'https://wa.me/260977740465')
    expect(screen.getByRole('link', { name: /email us/i })).toHaveAttribute(
      'href', 'mailto:support@zedexams.com')

    fireEvent.click(screen.getByRole('button', { name: /keep learning for now/i }))
    expect(onSkip).toHaveBeenCalled()
  })
})
