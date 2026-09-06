import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MissingProfileRecovery from './MissingProfileRecovery'

const ensureUserProfile = vi.fn()
const logout = vi.fn().mockResolvedValue()

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { email: 'milton56836@gmail.com' },
    profileIssue: 'unreadable',
    ensureUserProfile,
    logout,
  }),
}))

let degraded = false
vi.mock('../../firebase/appCheckResilient', () => ({
  attestationDegraded: () => degraded,
}))

beforeEach(() => {
  ensureUserProfile.mockReset()
  logout.mockClear()
  degraded = false
})

describe('MissingProfileRecovery', () => {
  it('shows the unreadable copy and the signed-in email', () => {
    render(<MissingProfileRecovery />)
    expect(screen.getByText(/could not read your account profile/i)).toBeInTheDocument()
    expect(screen.getByText('milton56836@gmail.com')).toBeInTheDocument()
  })

  it('does not show a security-check hint or support links on first arrival when attestation is healthy', () => {
    render(<MissingProfileRecovery />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(/Email support@zedexams\.com/i)).not.toBeInTheDocument()
  })

  it('surfaces the security-check hint on arrival when attestation is already degraded', () => {
    degraded = true
    render(<MissingProfileRecovery />)
    expect(screen.getByRole('status')).toHaveTextContent(/background security check/i)
  })

  it('does not offer a support fallback after a single failed repair', async () => {
    ensureUserProfile.mockResolvedValue(null)
    const user = userEvent.setup()
    render(<MissingProfileRecovery />)

    await user.click(screen.getByRole('button', { name: /repair my account/i }))

    expect(await screen.findByText(/could not restore this account automatically/i)).toBeInTheDocument()
    expect(screen.queryByText(/Still stuck after a few tries/i)).not.toBeInTheDocument()
  })

  it('offers a support fallback and the attestation hint after repeated failed repairs with degraded attestation', async () => {
    ensureUserProfile.mockResolvedValue(null)
    degraded = true
    const user = userEvent.setup()
    render(<MissingProfileRecovery />)

    const repairButton = screen.getByRole('button', { name: /repair my account/i })
    await user.click(repairButton)
    await user.click(repairButton)

    expect(await screen.findByText(/Still stuck after a few tries/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /support@zedexams\.com/i })).toHaveAttribute(
      'href',
      'mailto:support@zedexams.com',
    )
    expect(screen.getByRole('link', { name: /whatsapp support/i })).toHaveAttribute(
      'href',
      'https://wa.me/260977740465',
    )
    expect(screen.getByRole('status')).toHaveTextContent(/background security check/i)
  })

  it('calls logout when Sign Out is clicked', async () => {
    const user = userEvent.setup()
    render(<MissingProfileRecovery />)
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(logout).toHaveBeenCalledTimes(1)
  })
})
