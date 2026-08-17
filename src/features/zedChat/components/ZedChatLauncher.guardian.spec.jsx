/**
 * The Ask Zed pill obeys the guardian, and the two switches compose.
 *
 * `isAllowed` already has node coverage for the composition rule. What a
 * unit test of the core cannot show is that the COMPONENT asks it — and
 * that is the failure that actually happened: the launcher read the
 * child's own preference directly, so a guardian could switch Ask Zed off
 * and the pill stayed on screen, with the refusal arriving mid-conversation
 * from the server instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// One mutable profile the mocked auth context hands back, so each case can
// set the two switches and re-render.
let profile = null
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'learner-1' }, userProfile: profile }),
}))

import ZedChatLauncher from './ZedChatLauncher'

const LEARNER = { role: 'learner', displayName: 'Milton Phiri', grade: '7' }
const pill = () => screen.queryByRole('button', { name: /ask zed/i })

function renderAt(path = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ZedChatLauncher />
    </MemoryRouter>,
  )
}

describe('the Ask Zed pill and the guardian control', () => {
  beforeEach(() => { profile = { ...LEARNER } })

  it('shows when neither switch has been touched', () => {
    renderAt()
    expect(pill()).toBeInTheDocument()
  })

  it('disappears when the guardian switches Ask Zed off', () => {
    profile = { ...LEARNER, guardianControls: { askZed: false } }
    renderAt()
    expect(pill()).not.toBeInTheDocument()
  })

  it('disappears when the learner switches it off themselves', () => {
    profile = { ...LEARNER, learnerSettings: { zedAi: { enabled: false } } }
    renderAt()
    expect(pill()).not.toBeInTheDocument()
  })

  it("a guardian's ON does not override the child's own OFF", () => {
    // Permitting something is not requiring it — the composition rule the
    // control was specified with.
    profile = {
      ...LEARNER,
      guardianControls: { askZed: true },
      learnerSettings: { zedAi: { enabled: false } },
    }
    renderAt()
    expect(pill()).not.toBeInTheDocument()
  })

  it('stays when only the challenges control is off', () => {
    profile = { ...LEARNER, guardianControls: { challenges: false } }
    renderAt()
    expect(pill()).toBeInTheDocument()
  })

  it('treats an absent decision as no restriction', () => {
    // Three-valued: null is "no guardian has expressed a view", and a
    // stored non-boolean must read the same way rather than as an OFF.
    profile = { ...LEARNER, guardianControls: { askZed: null } }
    renderAt()
    expect(pill()).toBeInTheDocument()
  })

  it('is hidden inside the Guardian Zone', () => {
    renderAt('/guardian')
    expect(pill()).not.toBeInTheDocument()
  })
})
