/**
 * ZedChat.spec — the prototype-v5 Ask Zed surface (learner redesign
 * step 9). Pins the mockup's structure (intro card, chips, bubbles,
 * safety footer) and the streaming send path over a mocked transport.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

const sendAIChatStream = vi.fn()
vi.mock('../../../utils/aiAssistant', () => ({
  sendAIChatStream: (...args) => sendAIChatStream(...args),
}))

const authState = {
  currentUser: { uid: 'u1', displayName: 'Milton Banda' },
  userProfile: { displayName: 'Milton Banda', grade: 7, role: 'student' },
}
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => authState,
}))

vi.mock('../../../hooks/useSpeech', () => ({
  useSpeech: () => ({
    speak: vi.fn(), stop: vi.fn(), speaking: false, activeId: null,
    recognitionSupported: false, listening: false,
    interimTranscript: '', finalTranscript: '',
    recognitionError: null,
    startListening: vi.fn(), stopListening: vi.fn(), resetTranscript: vi.fn(),
  }),
}))

// ReportAiResponse reaches Firestore — out of scope here.
vi.mock('./ReportAiResponse', () => ({
  default: ({ surface }) => <div data-testid={`report-${surface}`} />,
}))

import ZedChat from './ZedChat'

beforeEach(() => {
  sessionStorage.clear()
  sendAIChatStream.mockReset()
  sendAIChatStream.mockReturnValue(() => {})
})

describe('ZedChat (prototype-v5 az layout)', () => {
  it('renders the mockup structure: header, personalised intro, chips, safety footer', () => {
    render(<ZedChat onBack={() => {}} />)
    expect(screen.getByText('Ask Zed')).toBeInTheDocument()
    expect(screen.getByText(/Your study helper · online/)).toBeInTheDocument()
    // Personalised greeting: first name + grade.
    expect(screen.getByText(/Hi Milton! 👋 I'm Zed\. Ask me anything about your Grade 7 topics/)).toBeInTheDocument()
    // Three suggestion chips.
    expect(screen.getByRole('button', { name: 'Help me with fractions' })).toBeInTheDocument()
    // Safety footer, verbatim from the mockup.
    expect(screen.getByText('🔒 Ask Zed keeps things school-safe · be kind · online only')).toBeInTheDocument()
    // Header 🚩 disabled until Zed has answered something.
    expect(screen.getByRole('button', { name: 'Report an answer' })).toBeDisabled()
  })

  it('a note topic seeds the topic greeting and chips (the reader pill context)', () => {
    render(<ZedChat topic="Conjunctions" onBack={() => {}} />)
    expect(screen.getByText(/You're learning Conjunctions\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explain Conjunctions simply' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Why does it matter in the exam?' })).toBeInTheDocument()
  })

  it('tapping a chip sends it: coral user bubble + streamed Zed reply', async () => {
    render(<ZedChat onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Help me with fractions' }))

    expect(sendAIChatStream).toHaveBeenCalledTimes(1)
    const call = sendAIChatStream.mock.calls[0][0]
    expect(call.message).toBe('Help me with fractions')
    expect(call.context.area).toBe('ask_zed')

    // The learner bubble is on screen immediately.
    expect(screen.getByText('Help me with fractions', { selector: '.lhx-az-b-user' })).toBeInTheDocument()

    // Stream a reply and finish.
    await act(async () => {
      call.onToken('A fraction is ')
      call.onToken('part of a whole.')
      call.onDone('A fraction is part of a whole.')
    })
    expect(screen.getByText(/part of a whole\./)).toBeInTheDocument()
    // Finished reply carries the per-message report control (Play policy).
    expect(screen.getByTestId('report-zed-chat')).toBeInTheDocument()
    // …and the header 🚩 is now live.
    expect(screen.getByRole('button', { name: 'Report an answer' })).not.toBeDisabled()
  })

  it('typing + Enter sends; input clears; send disabled while streaming', async () => {
    render(<ZedChat onBack={() => {}} />)
    const input = screen.getByLabelText('Ask Zed a question')
    fireEvent.change(input, { target: { value: 'What is a noun?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sendAIChatStream).toHaveBeenCalledTimes(1)
    expect(input.value).toBe('')
    // While streaming the send circle becomes Stop.
    expect(screen.getByRole('button', { name: 'Stop Zed' })).toBeInTheDocument()
    await act(async () => { sendAIChatStream.mock.calls[0][0].onDone('A noun names a thing.') })
    expect(screen.getByRole('button', { name: 'Send to Zed' })).toBeInTheDocument()
  })

  it('a transport error becomes an inline error bubble, not a dead end', async () => {
    render(<ZedChat onBack={() => {}} />)
    const input = screen.getByLabelText('Ask Zed a question')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await act(async () => { sendAIChatStream.mock.calls[0][0].onError(new Error('Network down')) })
    expect(screen.getByText('Network down')).toBeInTheDocument()
    // Recovered: the learner can send again.
    expect(screen.getByLabelText('Ask Zed a question')).not.toBeDisabled()
  })
})
