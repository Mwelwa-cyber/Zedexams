import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccountBody } from './AccountPanel'

// deleteMyAccount is the real Firebase path — stub it. pickReauthMethod stays
// faithful to the pure helper so the panel branches on the mocked providerData.
const deleteMyAccount = vi.fn()
vi.mock('../../../utils/accountService', () => ({
  deleteMyAccount: (...args) => deleteMyAccount(...args),
  pickReauthMethod: (providerData) =>
    Array.isArray(providerData) && providerData.some((p) => p?.providerId === 'password')
      ? 'password'
      : 'oauth',
}))

// Auth + subscription contexts and the invoice/payment cards are Firebase-heavy.
let mockUser = { email: 'learner@example.com', providerData: [{ providerId: 'password' }] }
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { createdAt: null }, currentUser: mockUser }),
}))
vi.mock('../../../hooks/useSubscription', () => ({
  useSubscription: () => ({ tierLabel: 'Free', isPremium: false }),
}))
vi.mock('../../learnerDashboard', () => ({ InvoicesCard: () => <div />, PaymentHistoryCard: () => <div /> }))

function renderPanel() {
  const pushToast = vi.fn()
  render(
    <MemoryRouter>
      <AccountBody pushToast={pushToast} />
    </MemoryRouter>,
  )
  return { pushToast }
}

describe('AccountPanel delete-account re-auth (LEGAL-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUser = { email: 'learner@example.com', providerData: [{ providerId: 'password' }] }
  })

  it('requires a password before a password account can delete, and forwards it', async () => {
    const user = userEvent.setup()
    deleteMyAccount.mockResolvedValue({ success: true })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /delete my account/i }))

    const deleteBtn = screen.getByRole('button', { name: /permanently delete/i })
    expect(deleteBtn).toBeDisabled()

    // Typing DELETE alone is not enough — the password is still required.
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE')
    expect(deleteBtn).toBeDisabled()

    await user.type(screen.getByLabelText(/your password/i), 'hunter2')
    expect(deleteBtn).toBeEnabled()

    await user.click(deleteBtn)
    await waitFor(() => expect(deleteMyAccount).toHaveBeenCalledWith({ password: 'hunter2' }))
  })

  it('surfaces a friendly message when re-auth fails (wrong password)', async () => {
    const user = userEvent.setup()
    deleteMyAccount.mockRejectedValue({ code: 'auth/wrong-password' })
    const { pushToast } = renderPanel()

    await user.click(screen.getByRole('button', { name: /delete my account/i }))
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE')
    await user.type(screen.getByLabelText(/your password/i), 'wrong')
    await user.click(screen.getByRole('button', { name: /permanently delete/i }))

    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith('error', expect.stringMatching(/password is incorrect/i)),
    )
    // The account is NOT deleted / navigated away from on a failed re-auth.
    expect(pushToast).not.toHaveBeenCalledWith('success', expect.anything())
  })

  it('a Google account needs no password field and deletes via the popup path', async () => {
    mockUser = { email: 'g@example.com', providerData: [{ providerId: 'google.com' }] }
    const user = userEvent.setup()
    deleteMyAccount.mockResolvedValue({ success: true })
    renderPanel()

    await user.click(screen.getByRole('button', { name: /delete my account/i }))
    expect(screen.queryByLabelText(/your password/i)).not.toBeInTheDocument()
    expect(screen.getByText(/confirm with google/i)).toBeInTheDocument()

    const deleteBtn = screen.getByRole('button', { name: /permanently delete/i })
    expect(deleteBtn).toBeDisabled()
    await user.type(screen.getByLabelText(/type delete to confirm/i), 'DELETE')
    expect(deleteBtn).toBeEnabled()

    await user.click(deleteBtn)
    await waitFor(() => expect(deleteMyAccount).toHaveBeenCalledWith({ password: '' }))
  })
})
