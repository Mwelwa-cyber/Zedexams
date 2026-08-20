/**
 * Behaviour tests for the guardian's permission switches.
 *
 * The one that matters most is the rollback: a switch showing OFF while
 * the child's account says ON is the worst state this screen can be in,
 * because the parent believes they have restricted something they have
 * not. So a rejected write must put the switch back and say so.
 *
 * The other two: a co-guardian may set controls but a stranger's role
 * cannot (the disabled state mirrors the server's capability check), and
 * "no guardian has decided" renders as ON rather than as a restriction
 * nobody set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../utils/clientErrorReporting', () => ({ reportClientError: vi.fn() }))

const setChildGuardianControl = vi.fn(() => Promise.resolve({ ok: true, changed: true }))
vi.mock('../services/parentApp', () => ({
  setChildGuardianControl: (...args) => setChildGuardianControl(...args),
}))

import ChildControls from './ChildControls'

const challenges = () => screen.getByRole('switch', { name: /live challenges/i })

describe('ChildControls', () => {
  beforeEach(() => {
    setChildGuardianControl.mockClear()
    setChildGuardianControl.mockResolvedValue({ ok: true, changed: true })
  })

  it('an undecided control renders as on — absent is not off', () => {
    render(<ChildControls childUid="kid-1" controls={{}} canEdit />)
    expect(challenges()).toHaveAttribute('aria-checked', 'true')
  })

  it('a guardian’s off is shown as off', () => {
    render(<ChildControls childUid="kid-1" controls={{ challenges: false }} canEdit />)
    expect(challenges()).toHaveAttribute('aria-checked', 'false')
  })

  it('turning one off writes through the callable for THAT child', async () => {
    const onChanged = vi.fn()
    render(<ChildControls childUid="kid-1" controls={{ challenges: true }} canEdit onChanged={onChanged} />)
    fireEvent.click(challenges())
    await waitFor(() =>
      expect(setChildGuardianControl).toHaveBeenCalledWith('kid-1', 'challenges', false))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('a rejected write puts the switch back and says nothing changed', async () => {
    setChildGuardianControl.mockRejectedValue(new Error('Only the account owner can do that.'))
    render(<ChildControls childUid="kid-1" controls={{ challenges: true }} canEdit />)

    fireEvent.click(challenges())
    // Optimistic first…
    expect(challenges()).toHaveAttribute('aria-checked', 'false')
    // …then reconciled with the server, which is the account's real state.
    await waitFor(() => expect(challenges()).toHaveAttribute('aria-checked', 'true'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing has changed/)
  })

  it('a guardian without the capability cannot move the switch', () => {
    render(<ChildControls childUid="kid-1" controls={{ challenges: true }} canEdit={false} />)
    expect(challenges()).toBeDisabled()
  })

  it('is disabled offline — the write is server-side', () => {
    render(<ChildControls childUid="kid-1" controls={{ challenges: true }} canEdit disabled />)
    expect(challenges()).toBeDisabled()
  })

  it('says where an OFF actually bites rather than implying more', () => {
    render(<ChildControls childUid="kid-1" controls={{}} canEdit />)
    expect(screen.getByText(/removed from their app/i)).toBeInTheDocument()
  })
})
