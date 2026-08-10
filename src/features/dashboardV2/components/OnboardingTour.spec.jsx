import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import OnboardingTour from './OnboardingTour'
import { TOUR_REPLAY_EVENT, TOUR_STORAGE_KEY } from '../lib/onboardingTourCore'

function renderTour({ entries = ['/teacher'], isMobile = false, loading = false } = {}) {
  return render(
    <MemoryRouter initialEntries={entries}>
      <OnboardingTour isMobile={isMobile} loading={loading} />
    </MemoryRouter>,
  )
}

describe('OnboardingTour', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows the welcome step on a first visit and advances / goes back', async () => {
    const user = userEvent.setup()
    renderTour()
    expect(screen.getByRole('dialog', { name: 'Welcome to your new dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    // No Back button on the first step.
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByRole('dialog', { name: 'Pick up where you left off' })).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })

  it('does not show while loading, or once dismissed on this device', () => {
    renderTour({ loading: true })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    localStorage.setItem(TOUR_STORAGE_KEY, 'done')
    renderTour()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Skip tour dismisses and persists the flag', async () => {
    const user = userEvent.setup()
    renderTour()
    await user.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done')
  })

  it('finishing the last step dismisses and persists the flag', async () => {
    const user = userEvent.setup()
    renderTour()
    for (let i = 0; i < 6; i += 1) {
      await user.click(screen.getByRole('button', { name: /Next|Start teaching/ }))
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(localStorage.getItem(TOUR_STORAGE_KEY)).toBe('done')
  })

  it('?tour=1 replays even after dismissal, and the mobile nav copy differs', () => {
    localStorage.setItem(TOUR_STORAGE_KEY, 'done')
    renderTour({ entries: ['/teacher?tour=1'], isMobile: true })
    expect(screen.getByRole('dialog', { name: 'Welcome to your new dashboard' })).toBeInTheDocument()
  })

  it('the replay window event restarts a dismissed tour', async () => {
    const user = userEvent.setup()
    localStorage.setItem(TOUR_STORAGE_KEY, 'done')
    renderTour()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    window.dispatchEvent(new Event(TOUR_REPLAY_EVENT))
    expect(await screen.findByRole('dialog', { name: 'Welcome to your new dashboard' })).toBeInTheDocument()

    // Escape dismisses again.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
