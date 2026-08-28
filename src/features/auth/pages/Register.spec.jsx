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

vi.mock('../../../firebase/config', () => ({
  default: {},
  auth: {},
  db: {},
  googleProvider: {},
  whenAppCheckReady: vi.fn(() => Promise.resolve({ initialized: true })),
  assertAuthAttested: vi.fn(() => Promise.resolve({ ok: true, reason: 'attested' })),
}))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../../../utils/referrals', () => ({ captureReferralFromUrl: () => null }))
// The age gate calls the retry-cooldown endpoint before routing, and the
// guardian step calls the consent sender. Stub both; each has its own spec.
const mockSendGuardianConsent = vi.fn()
const mockPreviewGuardianConsent = vi.fn()
vi.mock('../../../utils/ageGateService', () => ({
  recordAgeGateAttempt: vi.fn().mockResolvedValue({ blocked: false }),
  sendGuardianConsentRequest: (...a) => mockSendGuardianConsent(...a),
  previewGuardianConsentRequest: (...a) => mockPreviewGuardianConsent(...a),
  startSameDeviceConsent: vi.fn(),
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

/**
 * Type a date into the age screen and confirm it.
 *
 * `month` is a real calendar month (1–12), not the zero-based index the three
 * `<select>`s used to take — the screen is three numeric fields now, and the
 * value that reaches it is the one a thumb types.
 */
async function answerAge({ day, month, year }) {
  await waitFor(() => expect(screen.getByLabelText(/^day$/i)).toBeInTheDocument())
  fireEvent.change(screen.getByLabelText(/^day$/i), { target: { value: String(day).padStart(2, '0') } })
  fireEvent.change(screen.getByLabelText(/^month$/i), { target: { value: String(month).padStart(2, '0') } })
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: String(year) } })
  fireEvent.click(screen.getByRole('button', { name: /^continue$/i }))
}

/** Walk an adult learner all the way to the auth screen. */
async function renderRegister() {
  const result = mount()
  pickRole('learner')
  await answerAge({ day: 1, month: 1, year: 1990 })
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
    await answerAge({ day: 1, month: 1, year: 1990 })
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
    expect(screen.queryByLabelText(/their phone number/i)).toBeNull()
  })

  it('locks a returning learner to their first answer (criterion 5)', async () => {
    mount()
    pickRole('learner')
    await answerAge({ day: 3, month: 6, year: 2015 })
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
    await answerAge({ day: 3, month: 6, year: 2015 })
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
      expect(screen.getByRole('heading', { name: /how can we reach your grown-up/i })).toBeInTheDocument(),
    )
    // No dashboard navigation yet — the flow continues on this page.
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('does not ask the learner for a guardian before the account exists', async () => {
    mount()
    pickRole('learner')
    await answerAge({ day: 3, month: 6, year: 2015 })
    await waitFor(() => expect(screen.getByLabelText(/full name/i)).toBeInTheDocument())
    expect(screen.queryByLabelText(/parent or guardian/i)).toBeNull()
  })

  it('confirms the message before sending it, then says who it went to', async () => {
    // Nothing goes out until the child has seen the number echoed back and
    // the message the adult will receive. A mistyped digit is otherwise
    // invisible to everyone: the child waits, the guardian got nothing.
    mockPreviewGuardianConsent.mockResolvedValue({
      ok: true, dryRun: true, channel: 'whatsapp', allowed: true,
      contactDisplay: '+260 977 123 456',
      preview: { subject: '', body: 'Hello! Please approve this account.' },
    })
    mockSendGuardianConsent.mockResolvedValue({
      ok: true, sent: 'whatsapp_link', contactDisplay: '+260 977 123 456',
      waLink: 'https://wa.me/260977123456?text=x',
    })
    vi.stubGlobal('open', vi.fn())

    await signUpAsMinor()
    await waitFor(() => expect(screen.getByLabelText(/their phone number/i)).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/their phone number/i), {
      target: { value: '0977123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send the message/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /check this is right/i })).toBeInTheDocument())
    expect(mockSendGuardianConsent).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /yes, send it/i }))
    await waitFor(() =>
      expect(mockSendGuardianConsent).toHaveBeenCalledWith({
        contact: '0977123456', channel: 'whatsapp',
      }),
    )
    await waitFor(() => expect(screen.getByText(/message sent/i)).toBeInTheDocument())
    // Waiting is not blocking: the child is told what already works.
    expect(screen.getByText(/you can use these now/i)).toBeInTheDocument()
    expect(screen.getByText('+260 977 123 456')).toBeInTheDocument()
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
    await answerAge({ day: 3, month: 6, year: 2015 })
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
    await answerAge({ day: 3, month: 6, year: 2015 })
    await waitFor(() => expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /google/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /how can we reach your grown-up/i })).toBeInTheDocument(),
    )
    // And the date reached the account-creating call, with how it was
    // arrived at — a typed date and one estimated from a grade are not the
    // same evidence, and only the write path can record the difference.
    expect(mockLoginWithGoogle).toHaveBeenCalledWith({
      role: 'learner', onboarding: { dob: '2015-06-03', dobSource: 'typed' },
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

  it('refuses a password that ends in a space, and never calls register', async () => {
    // The reported bug. Firebase Auth stores the password byte-for-byte, so
    // 'pass123 ' and 'pass123' are two different credentials: accepting the
    // padded one mints an account whose owner can never type their way back
    // in, and the sign-in screen cannot diagnose it. See
    // src/utils/passwordPolicy.js.
    await renderRegister()
    fillValidLearner()
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'pass123 ' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'pass123 ' } })
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() =>
      expect(screen.getByText('Your password cannot start or end with a space.')).toBeInTheDocument(),
    )
    expect(mockRegister).not.toHaveBeenCalled()
  })

  it('accepts a passphrase with an interior space', async () => {
    // Deliberately NOT refused: a passphrase is the strongest thing a learner
    // will actually remember, so only the edges are policed.
    await renderRegister()
    fillValidLearner()
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'my dog rex' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'my dog rex' } })
    fireEvent.click(screen.getByRole('button', { name: /create free account/i }))

    await waitFor(() => expect(mockRegister).toHaveBeenCalled())
    expect(mockRegister.mock.calls[0][1]).toBe('my dog rex')
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
      // The age screen's answer travels with the signup, alongside how it was
      // arrived at. register() still derives isMinor from the DATE rather than
      // trusting a flag from here — `dobSource` is provenance for support and
      // a guardian dispute, and nothing routes on it — and the server
      // re-derives isMinor again on document creation.
      { dob: '1990-01-01', dobSource: 'typed' },
    )
  })
})
