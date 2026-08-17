/**
 * Subject-page behaviour, against the mockup's shape: accessible Term
 * 1/2/3 tabs with ?term deep links, real topic rows from the CBC
 * catalogue with their status pill, a row opening that topic's note,
 * an honest "Note coming soon" when none is published, and
 * wrong-subject safety. The page must NOT grow per-topic Lessons /
 * Quiz / Past Qs buttons again — the mockup has no such controls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))
vi.mock('../../../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => true }))

const mockAuth = {
  currentUser: { uid: 'learner-1', emailVerified: true },
  userProfile: { id: 'learner-1', displayName: 'Lydia Mwansa', grade: '7' },
  logout: vi.fn(),
  isAdmin: false,
  isTeacher: false,
}
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))

let mockQuizzes = []
vi.mock('../../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getQuizzes: vi.fn(async () => mockQuizzes),
    getUserResults: vi.fn(async () => []),
  }),
}))

let mockMaterials = []
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: vi.fn(async () => ({
    docs: mockMaterials.map((m) => ({ id: m.id, data: () => m })),
  })),
  doc: vi.fn(),
  getDoc: vi.fn(async () => ({ exists: () => false })),
  setDoc: vi.fn(async () => {}),
}))

import LearnerSubjectPage from './LearnerSubjectPage'

function NoteStub() {
  const { id } = useParams()
  return <div>NOTE {id}</div>
}

function renderSubject(path = '/subjects/science') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/subjects/:subjectId" element={<LearnerSubjectPage />} />
        <Route path="/notes/:id" element={<NoteStub />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockQuizzes = []
  mockMaterials = []
  window.localStorage.clear()
})

describe('LearnerSubjectPage', () => {
  it('renders accessible term tabs and the subject title', async () => {
    renderSubject()
    expect(screen.getByText('Integrated Science')).toBeInTheDocument()
    const tablist = screen.getByRole('tablist', { name: 'School terms' })
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'))
    expect(tabs.map((t) => t.textContent)).toEqual(['Term 1', 'Term 2', 'Term 3'])
    expect(tabs.filter((t) => t.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText(/Grade 7 topics/)).toBeNull())
  })

  it('honours a ?term=3 deep link and switches terms on tap', async () => {
    renderSubject('/subjects/science?term=3')
    const term3 = screen.getByRole('tab', { name: 'Term 3' })
    expect(term3.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Term 1' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Term 1' }).getAttribute('aria-selected')).toBe('true')
    })
  })

  it('lists the real Grade 7 CBC topics as rows, saying so when a note is missing', async () => {
    renderSubject()
    await waitFor(() => {
      expect(screen.getByText('The Human Body')).toBeInTheDocument()
    })
    const row = screen.getByText('The Human Body').closest('button')
    expect(row.classList.contains('lhx-topic-row')).toBe(true)
    // No note is published for it yet — the row says so instead of
    // leading nowhere.
    expect(within(row).getByText('Note coming soon')).toBeInTheDocument()
    expect(row).toHaveAttribute('aria-disabled', 'true')
  })

  it('a topic row opens that topic\u2019s note', async () => {
    mockMaterials = [{
      id: 'n1', noteFormat: 'study', isPublished: true, grade: '7',
      subject: 'science', term: '1', topic: 'The Human Body', title: 'The Human Body',
    }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Human Body')).toBeInTheDocument())
    fireEvent.click(screen.getByText('The Human Body').closest('button'))
    await waitFor(() => expect(screen.getByText('NOTE n1')).toBeInTheDocument())
  })

  it('has none of the retired per-topic actions (the mockup has no such buttons)', async () => {
    mockQuizzes = [{ id: 'q1', subject: 'science', topic: 'The Human Body', term: '1', isPublished: true }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Human Body')).toBeInTheDocument())
    for (const gone of [/^Quiz for/, /^Lessons for/, /^Past Qs for/, /^Notes for/]) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull()
    }
    // …and no bookmark control or resources list either.
    expect(screen.queryByRole('button', { name: /bookmark/i })).toBeNull()
    expect(screen.queryByText(/Resources$/)).toBeNull()
  })

  it('shows a safe message for an unknown subject', () => {
    renderSubject('/subjects/quantum-physics')
    expect(screen.getByText('This subject isn’t available for your grade.')).toBeInTheDocument()
  })
})
