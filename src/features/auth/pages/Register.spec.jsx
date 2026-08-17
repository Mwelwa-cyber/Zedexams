/**
 * Register.jsx — the sign-up flow.
 *
 * Two things are pinned here. The first is the original one: friendly
 * field-level validation via src/utils/formValidation.js — an invalid submit
 * names the exact field inline (no native browser bubble), blocks the
 * register() call, and a valid submit proceeds.
 *
 * The second is the reason the page became a sequence of screens. The age
 * question used to sit inside the email form while "Sign up with Google" sat
 * above it, so a learner who tapped Google created an account with no
 * declared age at all. An age screen one button avoids is not an age screen,
 * and these tests are what stops that regressing — they assert on what is
 * REACHABLE, not on what is displayed, because the bypass was never a visual
 * problem.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {}, googleProvider: {} }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../utils/referrals', () => ({ captureReferralFromUrl: () => null }))
// The age gate calls the retry-cooldown endpoint before routing, and the
// guardian step calls the consent sender. Stub both; each has its own spec.
const mockSendGuardianConsent = vi.fn()
vi.mock('../../../utils/ageGateService', () => ({
  recordAgeGateAttempt: vi.fn().mockResolvedValue({ blocked: false }),
  sendGuardianConsentRequest: (...a) => mockSendGuardianConsent(...a),
  getDeviceId: () => 'device-test',
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate }
})

import { useAuth } from '../../../contexts/AuthContext'
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

function mount(initialEntry = '/register') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Register />
    </MemoryRouter>,
  )
}

/** Role select → Continue. */
function pickRole(name) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name, 'i') }))
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
}

async function answerAge({ day, month, year }) {
  await waitFor(() => expect(screen.getByLabelText(/^day$/i)).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText(/^day$/i), { target: { value: String(day) } })
  fireEvent.change(screen.getByLabelText(/^month$/i), { target: { value: String(month) } })
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: String(year) } })
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
}

/** Walk an adult learner all the way to the auth screen. */
async function renderRegister() {
  const result = mount()
  pickRole('learner')
  await answerAge({ day: 1, month: 0, year: 1990 })
  await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
  return result
}

function fillValidLearner() {
  fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Test User' } })
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'learner@school.com' } })
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pass123' } })
  fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123' } })
  fireEvent.change(screen.getByLabelText(/school name/i), { target: { value: 'Lusaka Academy' } })
  // No grade field: it moved to the setup wizard's first step (/setup), and
  // LearnerSetupGate routes any learner without one there. The assertion that
  // it is really gone is its own test below.
}

it('does not ask a learner for their grade — that is the setup wizard\'s first step', async () => {
  await renderRegister()
  expect(screen.queryByLabelText(/^grade$/i)).toBeNull()
  // The rest of the learner form is untouched.
  expect(screen.getByLabelText(/school name/i)).toBeInTheDocument()
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  setAuth()
  mockSendGuardianConsent.mockResolvedValue({ ok: true, sent: 'email' })
})

// ── The bypass this rework closes ─────────────────────────────────

describe('Register — the age screen comes before every sign-up method', () => {
  it('offers no way to sign up on the role screen', () => {
    mount()
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    expect(screen.queryByLabelText(/^password$/i)).toBeNull()
  })

  it('shows a learner the age screen and no Google button (criterion 1)', async () => {
    mount()
    pickRole('learner')
    await waitFor(() => expect(screen.getByText(/when were you born/i)).toBeInTheDocument())
    // The whole point: the Google button does not exist yet.
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
  })

  it('shows a learner the email form only after the age screen (criterion 2)', async () => {
    mount()
    pickRole('learner')
    await waitFor(() => expect(screen.getByText(/when were you born/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/full name/i)).toBeNull()
    await answerAge({ day: 1, month: 0, year: 1990 })
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument()
  })

  it('redirects a deep link to the learner auth step back to the age screen (criterion 6)', async () => {
    // ?step=auth on the default (learner) role, with no date on file. The URL
    // proposes; resolveStep decides — and it lands on the age screen without
    // ever rendering a sign-up method.
    mount('/register?step=auth')
    await waitFor(() => expect(screen.getByText(/when were you born/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /google/i })).toBeNull()
    expect(screen.queryByLabelText(/^password$/i)).toBeNull()
  })

  it('redirects a deep link to the guardian step too — there is no account yet', async () => {
    mount('/register?step=guardian')
    await waitFor(() => expect(screen.getByText(/when were you born/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/guardian's email/i)).toBeNull()
  })

  it('locks a returning learner to their first answer (criterion 5)', async () => {
    mount()
    pickRole('learner')
    await answerAge({ day: 3, month: 5, year: 2015 })
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())

    // Back out to the age screen the way a user would — a fresh visit to the
    // page on the same device, inside the 24-hour window.
    const second = mount()
    fireEvent.click(second.getByRole('button', { name: /learner/i }))
    fireEvent.click(second.getByRole('button', { name: /^continue$/i }))
    await waitFor(() => expect(second.getByLabelText(/^year$/i)).toBeInTheDocument())
    expect(second.getByLabelText(/^year$/i).value).toBe('2015')
    expect(second.getByLabelText(/^year$/i)).toBeDisabled()
  })
})

// ── Teachers and parents are not asked ────────────────────────────

describe('Register — teachers and parents (criterion 7)', () => {
  it('asks a teacher for no date of birth at all', async () => {
    mount()
    pickRole('teacher')
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/^day$/i)).toBeNull()
    expect(screen.queryByLabelText(/^month$/i)).toBeNull()
    expect(screen.queryByLabelText(/^year$/i)).toBeNull()
    expect(screen.queryByText(/when were you born/i)).toBeNull()
  })

  it('asks a parent for no date of birth at all', async () => {
    mount()
    pickRole('parent')
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/^year$/i)).toBeNull()
  })

  it('blocks the email sign-up until the 18+ box is ticked', async () => {
    mount()
    pickRole('teacher')
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /request teacher account/i }))
    await waitFor(() =>
      expect(screen.getByText(/confirm that you are 18 years or older/i)).toBeInTheDocument(),
    )
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('blocks the Google sign-up until the 18+ box is ticked', async () => {
    // A deviation from the brief, stated in Register.jsx: there is no
    // post-Google completion step in this codebase to carry the confirmation,
    // so the same checkbox gates both methods.
    mount()
    pickRole('parent')
    await waitFor(() => expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /google/i }))
    await waitFor(() =>
      expect(screen.getByText(/confirm that you are 18 years or older/i)).toBeInTheDocument(),
    )
    expect(mockLoginWithGoogle).not.toHaveBeenCalled()
  })

  it('sends the attestation as a boolean, never as a date', async () => {
    mockRegister.mockResolvedValue({ user: { uid: 'uid-1' } })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-1', role: 'teacher' })
    mount()
    pickRole('teacher')
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText(/18 years or older/i))
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'T Banda' } })
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 't@school.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pass123' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123' } })
    fireEvent.change(screen.getByLabelText(/school name/i), { target: { value: 'Lusaka Academy' } })
    fireEvent.change(screen.getByLabelText(/^subject$/i), { target: { value: 'Mathematics' } })
    fireEvent.change(screen.getByLabelText(/^province$/i), { target: { value: 'Lusaka' } })
    fireEvent.click(screen.getByRole('button', { name: /request teacher account/i }))

    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1))
    const extras = mockRegister.mock.calls[0][6]
    expect(extras.ageConfirmed18Plus).toBe(true)
    expect(extras).not.toHaveProperty('dob')
  })
})

// ── The guardian hand-off ─────────────────────────────────────────

describe('Register — minors (criterion 3)', () => {
  async function signUpAsMinor() {
    mockRegister.mockResolvedValue({ user: { uid: 'uid-1' } })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-1', role: 'learner' })
    mount()
    pickRole('learner')
    await answerAge({ day: 3, month: 5, year: 2015 })
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    fillValidLearner()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))
    await waitFor(() => expect(mockRegister).toHaveBeenCalledTimes(1))
  }

  it('creates the account FIRST, then asks for a guardian', async () => {
    // The ordering is the point: nothing on the guardian screen can cost the
    // learner the account, and skipping it leaves a working limited-mode one.
    await signUpAsMinor()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /ask a parent or guardian/i })).toBeInTheDocument(),
    )
    // No dashboard navigation yet — the flow continues on this page.
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not ask the learner for a guardian before the account exists', async () => {
    mount()
    pickRole('learner')
    await answerAge({ day: 3, month: 5, year: 2015 })
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/parent or guardian/i)).toBeNull()
  })

  it('sends the approval link and confirms who it went to', async () => {
    await signUpAsMinor()
    await waitFor(() => expect(screen.getByLabelText(/guardian's email/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/guardian's email/i), {
      target: { value: 'parent@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send approval link/i }))

    await waitFor(() =>
      expect(mockSendGuardianConsent).toHaveBeenCalledWith({
        contact: 'parent@example.com', method: 'email',
      }),
    )
    await waitFor(() => expect(screen.getByText(/you're in/i)).toBeInTheDocument())
    expect(screen.getByText(/limited mode until your guardian approves/i)).toBeInTheDocument()
    expect(screen.getByText('parent@example.com')).toBeInTheDocument()
  })

  it('sends only the date of birth with the signup — no guardian contact yet', async () => {
    await signUpAsMinor()
    const extras = mockRegister.mock.calls[0][6]
    expect(extras.dob).toBe('2015-06-03')
    expect(extras).not.toHaveProperty('guardian')
  })
})

describe('Register — adult learners (criterion 4)', () => {
  it('never sees the guardian screen', async () => {
    mockRegister.mockResolvedValue({ user: { uid: 'uid-1' } })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-1', role: 'learner' })
    await renderRegister()
    fillValidLearner()
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/verify-email', { replace: true }))
    expect(screen.queryByText(/ask a parent or guardian/i)).toBeNull()
  })
})

// ── Existing accounts ─────────────────────────────────────────────

describe('Register — an existing account short-circuits (criterion 8)', () => {
  it('sends a returning Google user straight to their dashboard', async () => {
    mockLoginWithGoogle.mockResolvedValue({ user: { uid: 'uid-9' }, isNewAccount: false })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-9', role: 'learner' })
    mount()
    pickRole('learner')
    // Deliberately a minor's date: even so, an existing account must not be
    // pushed into the guardian flow or have its stored birthday rewritten.
    await answerAge({ day: 3, month: 5, year: 2015 })
    await waitFor(() => expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /google/i }))

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled())
    expect(screen.queryByText(/ask a parent or guardian/i)).toBeNull()
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('routes a NEW minor Google sign-up to the guardian screen instead', async () => {
    mockLoginWithGoogle.mockResolvedValue({ user: { uid: 'uid-10' }, isNewAccount: true })
    mockEnsureUserProfile.mockResolvedValue({ uid: 'uid-10', role: 'learner' })
    mount()
    pickRole('learner')
    await answerAge({ day: 3, month: 5, year: 2015 })
    await waitFor(() => expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /google/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /ask a parent or guardian/i })).toBeInTheDocument(),
    )
    // And the date reached the account-creating call.
    expect(mockLoginWithGoogle).toHaveBeenCalledWith({
      role: 'learner', onboarding: { dob: '2015-06-03' },
    })
  })
})

// ── The original validation behaviour, unchanged ──────────────────

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
      // The grade argument is now empty: the account is created without one
      // and the setup wizard writes it. LearnerSetupGate is what guarantees a
      // grade-less learner never reaches a screen that needs one.
      'learner@school.com', 'pass123', 'Test User', '', 'Lusaka Academy', 'learner',
      // The age screen's answer travels with the signup. register() still
      // derives isMinor from the date itself rather than trusting a flag from
      // here, and the server re-derives it again on document creation.
      { dob: '1990-01-01' },
    )
  })
})
