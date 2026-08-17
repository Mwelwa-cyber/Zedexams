/**
 * "A guardian control really restricts the child" — end to end on the client.
 *
 * It lives beside the launcher rather than in features/guardianZone because a
 * spec importing another feature's internals is the cross-feature edge
 * test:import-boundaries exists to refuse — and the component under test is
 * this one.
 *
 * The server half is covered by guardianControlsCore.test.js (the narrowing
 * property) and by the firestore.rules emulator (a learner cannot write
 * `guardianControls` or reach the PIN). What THIS file proves is the half a
 * unit test of the core cannot: that the child's actual screens read the
 * narrowed capability set, so switching Ask Zed off in the Guardian Zone
 * removes Ask Zed from the child's app rather than merely from a document.
 *
 * The distinction matters because the failure mode is silent — the core can be
 * perfectly correct while a component reads `currentUser` and renders the
 * button anyway, which is exactly what both of these did before this change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// One mutable profile the mocked auth context hands back, so each test can set
// the guardian's switches and re-render.
let profile = null
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1', displayName: 'Milton Phiri' }, userProfile: profile }),
}))

import ZedChatLauncher from './ZedChatLauncher'

const APPROVED = {
  role: 'learner',
  isMinor: true,
  displayName: 'Milton Phiri',
  grade: '7',
  guardian: { consentStatus: 'granted' },
}

function renderLauncher(at = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <ZedChatLauncher />
    </MemoryRouter>,
  )
}

describe('the Ask Zed pill obeys the guardian', () => {
  beforeEach(() => { profile = { ...APPROVED } })

  it('shows for an approved learner whose guardian has set nothing', () => {
    renderLauncher()
    expect(screen.getByRole('button', { name: /ask zed/i })).toBeInTheDocument()
  })

  it('disappears when the guardian switches Ask Zed off', () => {
    profile = { ...APPROVED, guardianControls: { askZed: false } }
    renderLauncher()
    expect(screen.queryByRole('button', { name: /ask zed/i })).not.toBeInTheDocument()
  })

  it('stays when the guardian switches only challenges off', () => {
    // The two controls are independent; taking one must not take the other.
    profile = { ...APPROVED, guardianControls: { challenges: false } }
    renderLauncher()
    expect(screen.getByRole('button', { name: /ask zed/i })).toBeInTheDocument()
  })

  it('disappears for a learner still waiting on guardian approval', () => {
    // Limited mode reaches the same gate — one capability set, two reasons.
    profile = { ...APPROVED, guardian: { consentStatus: 'pending' } }
    renderLauncher()
    expect(screen.queryByRole('button', { name: /ask zed/i })).not.toBeInTheDocument()
  })

  it('is hidden inside the Guardian Zone itself', () => {
    renderLauncher('/guardian')
    expect(screen.queryByRole('button', { name: /ask zed/i })).not.toBeInTheDocument()
  })

  it('a controls object claiming everything cannot re-enable a pending account', () => {
    // The hostile shape: a forged guardianControls saying yes on an account
    // whose guardian never approved. Controls narrow; they do not grant.
    profile = {
      ...APPROVED,
      guardian: { consentStatus: 'pending' },
      guardianControls: { askZed: true, challenges: true, aiChat: true },
    }
    renderLauncher()
    expect(screen.queryByRole('button', { name: /ask zed/i })).not.toBeInTheDocument()
  })
})
