import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FreePreviewUpsell from './FreePreviewUpsell'
import { capture } from '../../utils/analytics'

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

function renderUpsell() {
  return render(
    <MemoryRouter>
      <FreePreviewUpsell
        context="scheme-preview"
        title="Your first 2 weeks are ready."
        text="Upgrade to generate the complete term."
      />
    </MemoryRouter>,
  )
}

describe('FreePreviewUpsell', () => {
  it('shows the value-first message with upgrade + pricing actions and tracks display', () => {
    renderUpsell()
    expect(screen.getByText(/your first 2 weeks are ready/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /upgrade to pro/i })).toHaveAttribute('href', '/teacher/subscription')
    expect(screen.getByRole('link', { name: /view pricing/i })).toHaveAttribute('href', '/pricing')
    expect(capture).toHaveBeenCalledWith('upgrade_prompt_displayed', { context: 'scheme-preview' })
  })

  it('tracks which action was selected', () => {
    renderUpsell()
    fireEvent.click(screen.getByRole('link', { name: /upgrade to pro/i }))
    expect(capture).toHaveBeenCalledWith('upgrade_button_selected', { context: 'scheme-preview', action: 'upgrade' })
    fireEvent.click(screen.getByRole('link', { name: /view pricing/i }))
    expect(capture).toHaveBeenCalledWith('upgrade_button_selected', { context: 'scheme-preview', action: 'pricing' })
  })
})
