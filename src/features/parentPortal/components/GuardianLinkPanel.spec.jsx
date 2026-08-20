// The child's Guardian panel — what a child is told about who is watching
// them, and what they can do about it.
//
// Vitest + jsdom (see CLAUDE.md "Two test suites"). What is tested here is
// deliberately the COPY and the ROUTING, not the styling: this screen's job
// is to make an accurate statement to a nine-year-old and to send their
// answer to the right callable, and both are things a refactor can quietly
// break while the page still renders.

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const listMyLinkedParents = vi.fn()
const reportGuardianLink = vi.fn()
const requestGuardianUnlink = vi.fn()

vi.mock('../services/familyPortal', () => ({
  listMyLinkedParents: (...a) => listMyLinkedParents(...a),
  reportGuardianLink: (...a) => reportGuardianLink(...a),
  requestGuardianUnlink: (...a) => requestGuardianUnlink(...a),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'kid' } }),
}))

vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))

vi.mock('../../../shared/components/Button', () => ({
  default: ({ children, ...props }) => <button type="button" {...props}>{children}</button>,
}))

const { default: GuardianLinkPanel } = await import('./GuardianLinkPanel')

const approved = {
  id: 'mum_kid',
  parentUid: 'mum',
  learnerUid: 'kid',
  parentDisplayName: 'Mrs Banda',
  status: 'active',
  consent: { state: 'approved', method: 'family_code' },
  permissions: { challenges: false, dailyMinutes: 45 },
}

const pending = {
  id: 'stranger_kid',
  parentUid: 'stranger',
  learnerUid: 'kid',
  parentDisplayName: 'Mr Phiri',
  status: 'pending',
}

beforeEach(() => {
  vi.clearAllMocks()
  reportGuardianLink.mockResolvedValue({ ok: true, removed: true, message: 'We have removed them.' })
  requestGuardianUnlink.mockResolvedValue({ ok: true, filed: true, message: 'Nobody has been removed yet.' })
})

describe('GuardianLinkPanel', () => {
  it('names the adults who are linked, rather than saying "a parent account"', async () => {
    listMyLinkedParents.mockResolvedValue([approved])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText('Mrs Banda')).toBeInTheDocument()
  })

  it('says what a guardian can see AND what they cannot', async () => {
    // A list of what an adult CAN see, with no boundary on it, reads to a
    // child as "everything". The "cannot" half is not padding.
    listMyLinkedParents.mockResolvedValue([approved])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText(/What your grown-ups can see/i)).toBeInTheDocument()
    expect(screen.getByText(/What they cannot see/i)).toBeInTheDocument()
    expect(screen.getByText(/Your password/i)).toBeInTheDocument()
  })

  it('shows the permissions a guardian has actually set, in the child’s words', async () => {
    listMyLinkedParents.mockResolvedValue([approved])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText(/Whether you can play live challenges/i)).toBeInTheDocument()
    expect(screen.getByText(/45 minutes a day/i)).toBeInTheDocument()
  })

  it('always offers Childline 116 as a real tel: link', async () => {
    // The escape hatch that needs no guardian's permission — and the thing
    // that pays for a child not being able to unlink on their own.
    listMyLinkedParents.mockResolvedValue([approved])
    render(<GuardianLinkPanel />)
    const link = await screen.findByRole('link', { name: /Childline Zambia/i })
    expect(link).toHaveAttribute('href', 'tel:116')
  })







  it('offers "this isn’t my grown-up" on a confirmed link and never silently does nothing', async () => {
    listMyLinkedParents.mockResolvedValue([approved])
    render(<GuardianLinkPanel />)
    await userEvent.click(await screen.findByRole('button', { name: /This isn't my grown-up/i }))
    await waitFor(() => expect(reportGuardianLink).toHaveBeenCalledWith('mum'))
    // The child is told what happened. A button that reports and says
    // nothing is indistinguishable from one that is broken.
    expect(await screen.findByText(/We have removed them/i)).toBeInTheDocument()
  })

  it('files an unlink REQUEST and says plainly that nobody has been removed', async () => {
    listMyLinkedParents.mockResolvedValue([approved])
    render(<GuardianLinkPanel />)
    await userEvent.click(await screen.findByRole('button', { name: /Ask to remove them/i }))
    await waitFor(() => expect(requestGuardianUnlink).toHaveBeenCalledWith('mum'))
    expect(await screen.findByText(/Nobody has been removed yet/i)).toBeInTheDocument()
  })

  it('leaves the pending ask to FamilyCodePanel and never renders it twice', async () => {
    // Both panels sit on the same settings screen. The accept/decline
    // question belongs to the family-code flow that wrote `status`.
    listMyLinkedParents.mockResolvedValue([pending])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText(/Nobody is linked to your account yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/wants to be your guardian/i)).not.toBeInTheDocument()
  })

  it('does not ask a child to confirm a guardian who has been there for months', async () => {
    // A legacy link states no consent. Showing it as pending would read as
    // a new stranger appearing, for every child on the fleet, on the deploy
    // that shipped consent-on-links.
    listMyLinkedParents.mockResolvedValue([
      { id: 'mum_kid', parentUid: 'mum', learnerUid: 'kid', parentDisplayName: 'Mrs Banda' },
    ])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText('Mrs Banda')).toBeInTheDocument()
    expect(screen.queryByText(/wants to be your guardian/i)).not.toBeInTheDocument()
  })

  it('tells the child a withdrawn guardian can no longer see anything', async () => {
    listMyLinkedParents.mockResolvedValue([
      { ...approved, status: 'active', consent: { state: 'withdrawn', method: 'family_code' } },
    ])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText(/no longer see anything about you/i)).toBeInTheDocument()
    expect(screen.getByText(/lessons and past papers still work/i)).toBeInTheDocument()
  })

  it('says so when nobody is linked, rather than rendering an empty box', async () => {
    listMyLinkedParents.mockResolvedValue([])
    render(<GuardianLinkPanel />)
    expect(await screen.findByText(/Nobody is linked to your account yet/i)).toBeInTheDocument()
  })
})
