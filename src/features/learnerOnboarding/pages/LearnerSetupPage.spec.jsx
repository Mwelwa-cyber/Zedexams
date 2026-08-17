/**
 * The setup wizard's behaviour. The rules are unit-tested under plain node
 * (scripts/test-setup-wizard.mjs); what needs a DOM is the wiring — that the
 * subject list really re-derives from the grade the learner just tapped, that
 * the progress bar fills, and that the one profile write carries what the
 * four screens collected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const mockUpdate = vi.fn()
let mockProfile
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: mockProfile, updateProfileFields: mockUpdate, isLearner: true }),
}))

import LearnerSetupPage from './LearnerSetupPage'

function mount() {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<LearnerSetupPage />} />
        <Route path="/dashboard" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const cont = () => screen.getByRole('button', { name: /^continue$/i })

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue(undefined)
  mockProfile = { id: 'l1', role: 'learner', grade: '' }
})

describe('LearnerSetupPage', () => {
  it('opens on the grade step with Continue disabled until one is picked', () => {
    mount()
    expect(screen.getByRole('heading', { name: /what grade are you in/i })).toBeInTheDocument()
    expect(cont()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    expect(cont()).toBeEnabled()
  })

  it('offers only the grades the learner catalogue actually serves', () => {
    mount()
    for (const g of [4, 5, 6, 7]) {
      expect(screen.getByRole('button', { name: `Grade ${g}` })).toBeInTheDocument()
    }
    // The mockup's grid draws 8 and 9 too, but ALL_GRADES marks them
    // `active: false` — there is no content behind them, so offering one
    // lands a child on an empty app.
    expect(screen.queryByRole('button', { name: 'Grade 8' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Grade 9' })).toBeNull()
  })

  it('fills one more progress dot per step', () => {
    const { container } = mount()
    const on = () => container.querySelectorAll('.lhx-ob-step.is-on').length
    expect(container.querySelectorAll('.lhx-ob-step')).toHaveLength(4)
    expect(on()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    fireEvent.click(cont())
    expect(on()).toBe(2)
  })

  it('derives the subject chips from the grade that was just picked', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    fireEvent.click(cont())
    // The seven Grade 7 subjects, from the same accessor Home reads.
    expect(screen.getByRole('button', { name: /Integrated Science/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Home Economics/ })).toBeInTheDocument()
    // Not a subject a Grade 7 sits.
    expect(screen.queryByRole('button', { name: /Cinyanja/ })).toBeNull()
  })

  it('lets a learner continue without picking any subject', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    fireEvent.click(cont())
    expect(cont()).toBeEnabled()
  })

  it('walks all four screens and writes once, then lands Home', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 4' }))
    fireEvent.click(cont())
    fireEvent.click(screen.getByRole('button', { name: /English/ }))
    fireEvent.click(cont())
    expect(screen.getByRole('heading', { name: /meet zed/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /nice to meet you/i }))
    expect(screen.getByRole('heading', { name: /stay on track/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /yes, remind me/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.grade).toBe('4')
    expect(patch.learnerSubjects).toEqual(['english'])
    expect(patch.notificationPrefs.categories.learning).toBe(true)
    expect(patch.notificationPrefs.channels.push).toBe(true)
    await waitFor(() => expect(screen.getByText('HOME')).toBeInTheDocument())
  })

  it('"Not now" still completes setup — it answers the question, it does not skip it', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    fireEvent.click(cont())
    fireEvent.click(cont())
    fireEvent.click(screen.getByRole('button', { name: /nice to meet you/i }))
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.grade).toBe('7')
    expect(patch.notificationPrefs.channels.push).toBe(false)
  })

  it('picking every subject stores "no narrowing" rather than freezing the list', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    fireEvent.click(cont())
    for (const b of screen.getAllByRole('button', { pressed: false })) {
      if (b.className.includes('lhx-ob-subject')) fireEvent.click(b)
    }
    fireEvent.click(cont())
    fireEvent.click(screen.getByRole('button', { name: /nice to meet you/i }))
    fireEvent.click(screen.getByRole('button', { name: /not now/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    // Empty = every subject the grade takes, so a later curriculum change is
    // picked up instead of being frozen at today's catalogue.
    expect(mockUpdate.mock.calls[0][0].learnerSubjects).toEqual([])
  })

  it('a failed save says so and offers the button again — it never strands the child', async () => {
    mockUpdate.mockRejectedValue(new Error('offline'))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Grade 7' }))
    fireEvent.click(cont())
    fireEvent.click(cont())
    fireEvent.click(screen.getByRole('button', { name: /nice to meet you/i }))
    fireEvent.click(screen.getByRole('button', { name: /yes, remind me/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t save/i))
    expect(screen.getByRole('button', { name: /yes, remind me/i })).toBeEnabled()
    expect(screen.queryByText('HOME')).toBeNull()
  })

  it('carries no learner chrome — setup is not somewhere you tab away from', () => {
    const { container } = mount()
    expect(container.querySelector('.lhx-nav')).toBeNull()
    expect(container.querySelector('.lhx-topbar')).toBeNull()
  })
})
