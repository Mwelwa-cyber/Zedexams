import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../services/adminMfa', () => ({
  findTotpHint: vi.fn(),
  completeTotpSignIn: vi.fn(),
}))

import { findTotpHint, completeTotpSignIn } from '../../../services/adminMfa'
import MfaChallenge from './MfaChallenge'

const resolver = { hints: [{ factorId: 'totp', uid: 'h1' }], session: {} }

beforeEach(() => {
  vi.clearAllMocks()
  findTotpHint.mockReturnValue({ factorId: 'totp', uid: 'h1' })
})

function type6(digits = '123456') {
  const input = screen.getByLabelText(/six-digit verification code/i)
  fireEvent.change(input, { target: { value: digits } })
}

describe('MfaChallenge', () => {
  it('shows a recovery message and Back button when the resolver is lost', () => {
    const onCancel = vi.fn()
    render(<MfaChallenge resolver={null} onSuccess={vi.fn()} onCancel={onCancel} />)
    expect(screen.getByText(/session ended/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('resolves the sign-in and calls onSuccess with the credential', async () => {
    const cred = { user: { uid: 'admin1' } }
    completeTotpSignIn.mockResolvedValue(cred)
    const onSuccess = vi.fn()
    render(<MfaChallenge resolver={resolver} onSuccess={onSuccess} onCancel={vi.fn()} />)
    type6('123456')
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(cred))
    expect(completeTotpSignIn).toHaveBeenCalledWith(resolver, { factorId: 'totp', uid: 'h1' }, '123456')
  })

  it('shows a friendly error on an invalid code', async () => {
    const err = new Error('bad'); err.code = 'auth/invalid-verification-code'
    completeTotpSignIn.mockRejectedValue(err)
    render(<MfaChallenge resolver={resolver} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    type6('000000')
    fireEvent.click(screen.getByRole('button', { name: /^verify$/i }))
    await waitFor(() => expect(screen.getByText(/isn't right/i)).toBeInTheDocument())
  })

  it('blocks duplicate submissions while one is in flight', async () => {
    // Never-resolving promise keeps the first submit "in flight".
    let resolveIt
    completeTotpSignIn.mockReturnValue(new Promise((r) => { resolveIt = r }))
    render(<MfaChallenge resolver={resolver} onSuccess={vi.fn()} onCancel={vi.fn()} />)
    type6('123456')
    const btn = screen.getByRole('button', { name: /verify/i })
    fireEvent.click(btn)
    fireEvent.click(btn)
    fireEvent.click(btn)
    await waitFor(() => expect(completeTotpSignIn).toHaveBeenCalledTimes(1))
    resolveIt?.({ user: {} })
  })
})
