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

function renderRegister() {
  return render(
    <MemoryRouter>
      <Register />
    </MemoryRouter>,
  )
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
    renderRegister()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Please enter your full name.')).toBeInTheDocument(),
    )
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(mockRegister).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('rejects an invalid email with the friendly message', async () => {
    renderRegister()
    fillValidLearner()
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument(),
    )
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('flags a password mismatch on the confirm field', async () => {
    renderRegister()
    fillValidLearner()
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument(),
    )
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('clears a field error once the user starts fixing it', async () => {
    renderRegister()
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
    renderRegister()
    fillValidLearner()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1))
    expect(mockRegister).toHaveBeenCalledWith(
      'learner@school.com', 'pass123', 'Test User', '5', 'Lusaka Academy', 'learner', {},
    )
  })
})
