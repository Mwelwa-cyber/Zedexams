/**
 * Register.jsx — friendly field-level validation.
 *
 * Locks the spec behaviour wired via src/utils/formValidation.js: an invalid
 * submit names the exact field inline (no native browser bubble), blocks the
 * register() call, and a valid submit proceeds. focusFirstError's scroll is a
 * no-op in jsdom (guarded), so these assert the messages + gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, googleProvider: {} }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../utils/referrals', () => ({ captureReferralFromUrl: () => null }))
// The age gate calls the retry-cooldown endpoint before routing. Stub it so
// these tests exercise the account form; the gate has its own spec.
vi.mock('../../utils/ageGateService', () => ({
  recordAgeGateAttempt: vi.fn().mockResolvedValue({ blocked: false }),
  sendGuardianConsentRequest: vi.fn().mockResolvedValue({ ok: true }),
  getDeviceId: () => 'device-test',
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useAuth } from '../../contexts/AuthContext'
import Register from './Register'

const mockRegister = vi.fn()
const mockLoginWithGoogle = vi.fn()
const mockEnsureUserProfile = vi.fn()

function setAuth(overrides = {}) {
  useAuth.mockReturnValue({
    register: mockRegister,
    loginWithGoogle: mockLoginWithGoogle,
    ensureUserProfile: mockEnsureUserProfile,
    ...overrides,
  })
}

/**
 * Clear the neutral age screen with an adult date of birth.
 *
 * The age gate now renders INSTEAD of the account form until it is answered,
 * so every test that touches the form has to pass through it first. An adult
 * date keeps these tests on the unchanged path — the child branch is covered
 * in AgeGateStep.spec.jsx.
 */
async function passAgeGateAsAdult() {
  fireEvent.change(screen.getByLabelText(/^day$/i), { target: { value: '1' } })
  fireEvent.change(screen.getByLabelText(/^month$/i), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '1990' } })
  fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
}

async function renderRegister() {
  const result = render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  )
  await passAgeGateAsAdult()
  return result
}

function fillValidLearner() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Test User' } })
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'learner@school.com' } })
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pass123' } })
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123' } })
  fireEvent.change(screen.getByLabelText(/school name/i), { target: { value: 'Lusaka Academy' } })
  fireEvent.change(screen.getByLabelText(/^grade$/i), { target: { value: '5' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  setAuth()
})

describe('Register — friendly field validation', () => {
  it('shows inline field errors on an empty submit and does not call register()', async () => {
    await renderRegister()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Please enter your full name.')).toBeInTheDocument(),
    )
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(mockRegister).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('rejects an invalid email with the friendly message', async () => {
    await renderRegister()
    fillValidLearner()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument(),
    )
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('flags a password mismatch on the confirm field', async () => {
    await renderRegister()
    fillValidLearner()
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument(),
    )
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('clears a field error once the user starts fixing it', async () => {
    await renderRegister()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))
    await waitFor(() =>
      expect(screen.getByText('Please enter your full name.')).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'A' } })
    expect(screen.queryByText('Please enter your full name.')).not.toBeInTheDocument()
  })

  it('submits when every field is valid', async () => {
    mockRegister.mockResolvedValue({ user: { uid: 'uid-1' } })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-1', role: 'learner' })
    await renderRegister()
    fillValidLearner()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1))
    expect(mockRegister).toHaveBeenCalledWith(
      'learner@school.com', 'pass123', 'Test User', '5', 'Lusaka Academy', 'learner',
      // The age screen's answer travels with the signup. An adult date means
      // no guardian — register() still derives isMinor from the DOB itself
      // rather than trusting a flag from here.
      { dob: '1990-01-01', guardian: null },
    )
  })

  it('carries the guardian contact through when the learner is a minor', async () => {
    mockRegister.mockResolvedValue({ user: { uid: 'uid-1' } })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-1', role: 'learner' })
    render(<MemoryRouter><Register /></MemoryRouter>)

    fireEvent.change(screen.getByLabelText(/^day$/i), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/^month$/i), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2015' } })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    // A minor gets the guardian step, not the account form.
    await waitFor(() =>
      expect(screen.getByLabelText(/parent or guardian's email/i)).toBeInTheDocument(),
    )
    fireEvent.change(screen.getByLabelText(/parent or guardian's email/i), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    fillValidLearner()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1))
    const extras = mockRegister.mock.calls[0][6]
    expect(extras.dob).toBe('2015-06-03')
    expect(extras.guardian).toEqual({
      contact: 'parent@example.com',
      method: 'email',
      // Always pending from the client. Only confirmGuardianConsent writes
      // 'granted', and firestore.rules pins the field against client writes.
      consentStatus: 'pending',
    })
  })
})
