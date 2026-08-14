/**
 * LearnerSearch — the /search page. Guards the query-gated states (prompt →
 * loading → results / no-results) and that results link to their content.
 * The data hook is mocked; this exercises the page's own rendering + input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ userProfile: { grade: '5' } }) }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../../../shared/components/Skeleton', () => ({ default: () => <div data-testid="skeleton" /> }))
vi.mock('../../../shared/components/Icon', () => ({ default: () => null }))
vi.mock('../../../shared/components/icons', () => ({ Search: () => null }))

let mockSearch = { loading: false, groups: { quiz: [], note: [], paper: [], game: [] }, total: 0 }
vi.mock('../../../hooks/useLearnerSearch', () => ({ useLearnerSearch: () => mockSearch }))

import LearnerSearch from './LearnerSearch'

function renderPage() {
  return render(<MemoryRouter initialEntries={['/search']}><LearnerSearch /></MemoryRouter>)
}

beforeEach(() => {
  mockSearch = { loading: false, groups: { quiz: [], note: [], paper: [], game: [] }, total: 0 }
})

describe('LearnerSearch', () => {
  it('shows the discovery prompt before any query is typed', () => {
    renderPage()
    expect(screen.getByText(/Find anything in ZedExams/i)).toBeInTheDocument()
  })

  it('renders grouped results with links once a query is entered', () => {
    mockSearch = {
      loading: false,
      total: 2,
      groups: {
        quiz: [{ id: 'q1', type: 'quiz', title: 'Fractions Quiz', subtitle: 'Mathematics', route: '/quiz/q1' }],
        note: [{ id: 'n1', type: 'note', title: 'Cells Note', subtitle: 'Science', route: '/notes/n1' }],
        paper: [], game: [],
      },
    }
    renderPage()
    fireEvent.change(screen.getByLabelText('Search all content'), { target: { value: 'fractions' } })

    expect(screen.getByText('Quizzes')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fractions Quiz/ })).toHaveAttribute('href', '/quiz/q1')
    expect(screen.getByRole('link', { name: /Cells Note/ })).toHaveAttribute('href', '/notes/n1')
    expect(screen.getByText(/2 results for/i)).toBeInTheDocument()
  })

  it('shows the no-results state when a query matches nothing', () => {
    mockSearch = { loading: false, total: 0, groups: { quiz: [], note: [], paper: [], game: [] } }
    renderPage()
    fireEvent.change(screen.getByLabelText('Search all content'), { target: { value: 'zzz' } })
    expect(screen.getByText(/No results for/i)).toBeInTheDocument()
  })

  it('shows skeletons while loading a query', () => {
    mockSearch = { loading: true, total: 0, groups: { quiz: [], note: [], paper: [], game: [] } }
    renderPage()
    fireEvent.change(screen.getByLabelText('Search all content'), { target: { value: 'loading' } })
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0)
  })

  it('seeds the input from the ?q= URL param', () => {
    render(<MemoryRouter initialEntries={['/search?q=science']}><LearnerSearch /></MemoryRouter>)
    expect(screen.getByLabelText('Search all content')).toHaveValue('science')
  })
})
