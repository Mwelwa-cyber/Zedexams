import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import StudioNextSteps from './StudioNextSteps'
import { capture } from '../../utils/analytics'

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

function renderPanel(props) {
  return render(
    <MemoryRouter>
      <StudioNextSteps {...props} />
    </MemoryRouter>,
  )
}

describe('StudioNextSteps', () => {
  it('renders nothing when there are no actions or facts', () => {
    const { container } = renderPanel({ context: 'x', actions: [], facts: [] })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders actions as links and facts as checkmarked notes', () => {
    renderPanel({
      context: 'scheme-of-work',
      actions: [
        { key: 'weekly-focus', label: 'Create Weekly Focus from this scheme', to: '/teacher/generate/weekly-forecast?schemeId=abc' },
        { key: 'later', label: 'Save and return later', to: '/teacher' },
      ],
      facts: ['Questions saved to your Question Bank'],
    })
    expect(screen.getByText('What would you like to do next?')).toBeInTheDocument()
    expect(screen.getByText(/questions saved to your question bank/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /create weekly focus from this scheme/i }))
      .toHaveAttribute('href', '/teacher/generate/weekly-forecast?schemeId=abc')
    expect(screen.getByRole('link', { name: /save and return later/i }))
      .toHaveAttribute('href', '/teacher')
  })

  it('tracks the selected next step', () => {
    renderPanel({
      context: 'weekly-focus',
      actions: [{ key: 'lesson', label: 'Create this week’s lessons', to: '/teacher/lesson-plans/new' }],
    })
    fireEvent.click(screen.getByRole('link', { name: /create this week’s lessons/i }))
    expect(capture).toHaveBeenCalledWith('studio_next_step_selected', { context: 'weekly-focus', action: 'lesson' })
  })
})
