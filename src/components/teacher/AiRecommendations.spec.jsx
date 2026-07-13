import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AiRecommendations from './AiRecommendations'
import { capture } from '../../utils/analytics'

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

function rec(id, extra = {}) {
  return {
    id,
    icon: '📘',
    title: `Title ${id}`,
    text: `Text ${id}`,
    actionLabel: `Act ${id}`,
    to: `/teacher/route-${id}`,
    ...extra,
  }
}

function renderRecs(recommendations) {
  return render(
    <MemoryRouter>
      <AiRecommendations recommendations={recommendations} />
    </MemoryRouter>,
  )
}

describe('AiRecommendations', () => {
  it('renders nothing when no condition matched', () => {
    const { container } = renderRecs([])
    expect(container).toBeEmptyDOMElement()
  })

  it('shows at most three cards with working action buttons', () => {
    renderRecs([rec('a'), rec('b'), rec('c'), rec('d'), rec('e')])
    expect(screen.getByText('Title a')).toBeInTheDocument()
    expect(screen.getByText('Title c')).toBeInTheDocument()
    expect(screen.queryByText('Title d')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /act b/i })).toHaveAttribute('href', '/teacher/route-b')
  })

  it('expands to the full list via "View all recommendations" and tracks clicks', () => {
    renderRecs([rec('a'), rec('b'), rec('c'), rec('d')])
    fireEvent.click(screen.getByRole('button', { name: /view all recommendations/i }))
    expect(screen.getByText('Title d')).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('ai_recommendations_expanded', { hidden: 1 })
    fireEvent.click(screen.getByRole('link', { name: /act a/i }))
    expect(capture).toHaveBeenCalledWith('ai_recommendation_selected', { id: 'a' })
  })

  it('hides the View all button when three or fewer cards exist', () => {
    renderRecs([rec('a'), rec('b')])
    expect(screen.queryByRole('button', { name: /view all/i })).not.toBeInTheDocument()
  })
})
