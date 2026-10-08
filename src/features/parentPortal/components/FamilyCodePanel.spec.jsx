// FamilyCodePanel — the learner-side family code control.
//
// Since parent sign-up was removed, the learner Settings mount passes
// allowNewCode={false}: no NEW code can be made, but a request left by a code
// already in the world must still be answerable, and an active code must
// still be turn-off-able.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createFamilyInviteCode = vi.fn()
const revokeFamilyInviteCode = vi.fn()
const listMyFamilyCodes = vi.fn()
const listMyLinkedParents = vi.fn()
const respondToFamilyLink = vi.fn()

vi.mock('../services/familyPortal', () => ({
  createFamilyInviteCode: (...a) => createFamilyInviteCode(...a),
  revokeFamilyInviteCode: (...a) => revokeFamilyInviteCode(...a),
  listMyFamilyCodes: (...a) => listMyFamilyCodes(...a),
  listMyLinkedParents: (...a) => listMyLinkedParents(...a),
  respondToFamilyLink: (...a) => respondToFamilyLink(...a),
  requestGuardianUnlink: vi.fn(),
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'kid' } }),
}))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../shared/components/Button', () => ({
  default: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
}))

const { default: FamilyCodePanel } = await import('./FamilyCodePanel')

const activeCode = { code: 'ABC123', expiresAtMs: Date.now() + 86_400_000 }
const pendingLink = {
  id: 'mum_kid', parentUid: 'mum', learnerUid: 'kid',
  parentDisplayName: 'Mrs Banda', status: 'pending',
}

beforeEach(() => {
  vi.clearAllMocks()
  listMyFamilyCodes.mockResolvedValue([])
  listMyLinkedParents.mockResolvedValue([])
  respondToFamilyLink.mockResolvedValue({})
  revokeFamilyInviteCode.mockResolvedValue({})
})

describe('FamilyCodePanel with allowNewCode={false}', () => {
  it('offers no way to create a code', async () => {
    render(<FamilyCodePanel allowNewCode={false} />)
    await screen.findByText(/Family & parents/i)
    expect(screen.queryByRole('button', { name: /Create a family code/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /New code/i })).toBeNull()
    expect(screen.queryByText(/Share a family code/i)).toBeNull()
  })

  it('does not display an active code, but can still turn it off', async () => {
    listMyFamilyCodes.mockResolvedValue([activeCode])
    render(<FamilyCodePanel allowNewCode={false} />)
    expect(await screen.findByText(/family code that is still active/i)).toBeInTheDocument()
    expect(screen.queryByText('ABC123')).toBeNull()
    expect(screen.queryByRole('button', { name: /New code/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Turn off/i }))
    await waitFor(() => expect(revokeFamilyInviteCode).toHaveBeenCalledWith('ABC123'))
    expect(createFamilyInviteCode).not.toHaveBeenCalled()
  })

  it('still lets the child answer a pending request', async () => {
    listMyLinkedParents.mockResolvedValue([pendingLink])
    render(<FamilyCodePanel allowNewCode={false} />)
    await userEvent.click(await screen.findByRole('button', { name: /Yes, that is my grown-up/i }))
    await waitFor(() => expect(respondToFamilyLink).toHaveBeenCalledWith('mum_kid', 'accept'))
  })
})

describe('FamilyCodePanel default', () => {
  it('still creates a code when new codes are allowed', async () => {
    createFamilyInviteCode.mockResolvedValue({})
    render(<FamilyCodePanel />)
    await userEvent.click(await screen.findByRole('button', { name: /Create a family code/i }))
    await waitFor(() => expect(createFamilyInviteCode).toHaveBeenCalled())
  })
})
