import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AiRecommendations from './AiRecommendations'
import { capture } from '../../../utils/analytics'

vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

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

  it('expands via "View all recommendations", announces state, and collapses via "Show fewer"', () => {
    renderRecs([rec('a'), rec('b'), rec('c'), rec('d')])
    const toggle = screen.getByRole('button', { name: /view all recommendations/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText('Title d')).toBeInTheDocument()
    expect(capture).toHaveBeenCalledWith('ai_recommendations_expanded', { hidden: 1 })

    // The control flips to "Show fewer recommendations" and collapses back.
    const collapse = screen.getByRole('button', { name: /show fewer recommendations/i })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(collapse)
    expect(screen.queryByText('Title d')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view all recommendations/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: /act a/i }))
    expect(capture).toHaveBeenCalledWith('ai_recommendation_selected', { id: 'a' })
  })

  it('hides the View all button when three or fewer cards exist', () => {
    renderRecs([rec('a'), rec('b')])
    expect(screen.queryByRole('button', { name: /view all/i })).not.toBeInTheDocument()
  })

  it('caps rendered cards even when expanded', () => {
    const many = Array.from({ length: 12 }, (_, i) => rec(`r${i}`))
    renderRecs(many)
    fireEvent.click(screen.getByRole('button', { name: /view all recommendations/i }))
    expect(screen.getByText('Title r8')).toBeInTheDocument()
    expect(screen.queryByText('Title r9')).not.toBeInTheDocument()
  })

  it('renders each card with its OWN subject title, scope and href (no leak across the map)', () => {
    // Mirrors the per-assignment scheme cards: same type, distinct subjects.
    const cards = [
      { id: 'scheme-english::a1', title: 'English is not planned yet', scope: 'Grade 4 · English', to: '/teacher/generate/scheme-of-work?grade=G4&subject=english&term=2' },
      { id: 'scheme-mathematics::a2', title: 'Mathematics is not planned yet', scope: 'Grade 4 · Mathematics', to: '/teacher/generate/scheme-of-work?grade=G4&subject=mathematics&term=2' },
      { id: 'scheme-technology_studies::a3', title: 'Technology Studies is not planned yet', scope: 'Grade 4 · Technology Studies', to: '/teacher/generate/scheme-of-work?grade=G4&subject=technology_studies&term=2' },
    ].map((c) => ({ icon: '📘', text: `Create a Scheme of Work for ${c.scope.split(' · ')[1]}`, actionLabel: 'Create Scheme', ...c }))
    renderRecs(cards)

    // Every distinct subject shows exactly once — no card borrows another's.
    expect(screen.getByText('English is not planned yet')).toBeInTheDocument()
    expect(screen.getByText('Mathematics is not planned yet')).toBeInTheDocument()
    expect(screen.getByText('Technology Studies is not planned yet')).toBeInTheDocument()
    expect(screen.getByText('Grade 4 · English')).toBeInTheDocument()

    // Each "Create Scheme" link carries its own subject in the deep link.
    const links = screen.getAllByRole('link', { name: /create scheme/i })
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/teacher/generate/scheme-of-work?grade=G4&subject=english&term=2',
      '/teacher/generate/scheme-of-work?grade=G4&subject=mathematics&term=2',
      '/teacher/generate/scheme-of-work?grade=G4&subject=technology_studies&term=2',
    ])
  })
})
