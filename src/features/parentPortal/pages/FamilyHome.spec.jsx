/**
 * FamilyHome — the parent's /family landing: children list + add-a-child by
 * family code. Guards the empty state, the populated list, and the redeem flow
 * (success refreshes the list; failure surfaces a friendly error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))

const mockListMyChildren = vi.fn()
const mockRedeem = vi.fn()
vi.mock('../services/familyPortal', () => ({
  listMyChildren: (...a) => mockListMyChildren(...a),
  redeemFamilyInviteCode: (...a) => mockRedeem(...a),
}))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))
vi.mock('../../../components/seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../components/ui/Skeleton', () => ({ default: () => <div data-testid="skeleton" /> }))
vi.mock('../../../components/ui/Button', () => ({ default: ({ children, ...p }) => <button {...p}>{children}</button> }))

let mockAuth = { currentUser: { uid: 'parent-1' } }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

import FamilyHome from './FamilyHome'

function renderHome() {
  return render(<MemoryRouter><FamilyHome /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth = { currentUser: { uid: 'parent-1' } }
  mockListMyChildren.mockResolvedValue([])
  mockRedeem.mockResolvedValue({ learnerDisplayName: 'Amara' })
})

describe('FamilyHome', () => {
  it('shows the empty state when no children are linked', async () => {
    renderHome()
    expect(await screen.findByText('No children linked yet')).toBeInTheDocument()
  })

  it('renders a card per linked child with the grade', async () => {
    mockListMyChildren.mockResolvedValue([
      { id: 'p_c1', learnerUid: 'c1', learnerDisplayName: 'Amara Banda', learnerGrade: '5' },
    ])
    renderHome()
    expect(await screen.findByText('Amara Banda')).toBeInTheDocument()
    expect(screen.getByText('Grade 5')).toBeInTheDocument()
    // links to the child's progress page
    expect(screen.getByRole('link', { name: /Amara Banda/ })).toHaveAttribute('href', '/family/child/c1')
  })

  it('redeems a family code and refreshes the children list', async () => {
    mockListMyChildren.mockResolvedValueOnce([]) // initial
    renderHome()
    await screen.findByText('No children linked yet')

    // After a successful link, the list reloads with the new child.
    mockListMyChildren.mockResolvedValueOnce([
      { id: 'p_c1', learnerUid: 'c1', learnerDisplayName: 'Amara', learnerGrade: '5' },
    ])
    fireEvent.change(screen.getByLabelText('Family code'), { target: { value: 'ab7kmn2p' } })
    fireEvent.click(screen.getByRole('button', { name: /Link child/i }))

    await waitFor(() => expect(mockRedeem).toHaveBeenCalledWith('ab7kmn2p'))
    expect(await screen.findByText(/Linked Amara to your family/i)).toBeInTheDocument()
  })

  it('shows a friendly error when the code is rejected', async () => {
    renderHome()
    await screen.findByText('No children linked yet')
    mockRedeem.mockRejectedValueOnce(new Error('This family code has expired.'))

    fireEvent.change(screen.getByLabelText('Family code'), { target: { value: 'BADCODE1' } })
    fireEvent.click(screen.getByRole('button', { name: /Link child/i }))

    expect(await screen.findByText(/This family code has expired/i)).toBeInTheDocument()
  })
})
