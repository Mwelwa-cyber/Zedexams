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

  it('lists the term plan topics as rows, saying so when a note is missing', async () => {
    // Grade 7 Science has a published term plan, so the rows are its
    // SUB-topics ("The Digestive System"), not the catalogue's five parent
    // topics — the parent is the strand tag beside the name.
    renderSubject('/subjects/science?term=1')
    await waitFor(() => {
      expect(screen.getByText('The Digestive System')).toBeInTheDocument()
    })
    const row = screen.getByText('The Digestive System').closest('button')
    expect(row.classList.contains('lhx-topic-row')).toBe(true)
    expect(within(row).getByText('Human Body')).toBeInTheDocument()
    // No note is published for it yet — the row says so instead of
    // leading nowhere.
    expect(within(row).getByText('Note coming soon')).toBeInTheDocument()
    expect(row).toHaveAttribute('aria-disabled', 'true')
  })

  it('a topic row opens that topic\u2019s note', async () => {
    mockMaterials = [{
      id: 'n1', noteFormat: 'study', isPublished: true, grade: '7',
      subject: 'science', term: '1', topic: 'The Digestive System', title: 'The Digestive System',
    }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    fireEvent.click(screen.getByText('The Digestive System').closest('button'))
    await waitFor(() => expect(screen.getByText('NOTE n1')).toBeInTheDocument())
  })

  it('has none of the retired per-topic actions (the mockup has no such buttons)', async () => {
    mockQuizzes = [{ id: 'q1', subject: 'science', topic: 'The Digestive System', term: '1', isPublished: true }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
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

  // ── The term switcher actually switches ────────────────────────────
  //
  // The reported bug: all three tabs showed the same list. Grade 7 English
  // and Integrated Science now carry the owner's published term plan, so
  // these assert the tabs really differ; the subjects with no plan assert
  // the honest fallback instead of a fabricated split.

  it('each term shows a different list for a subject with a plan', async () => {
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    // A Term 2 topic is not on the Term 1 tab.
    expect(screen.queryByText('The Flower')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Term 2' }))
    await waitFor(() => expect(screen.getByText('The Flower')).toBeInTheDocument())
    expect(screen.queryByText('The Digestive System')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Term 3' }))
    await waitFor(() => expect(screen.getByText('Electric Circuits')).toBeInTheDocument())
    expect(screen.queryByText('The Flower')).toBeNull()
  })

  it('English carries the plan too, with its language strands', async () => {
    renderSubject('/subjects/english?term=2')
    await waitFor(() => {
      expect(screen.getByText('Conjunctions — Joining Words')).toBeInTheDocument()
    })
    const row = screen.getByText('Conjunctions — Joining Words').closest('button')
    expect(within(row).getByText('Structure')).toBeInTheDocument()
    // Term 1's Nouns is not on this tab.
    expect(screen.queryByText('Nouns')).toBeNull()
  })

  it('says that unplaced topics are on every tab, rather than hiding them', async () => {
    // Three Grade 7 Science sub-topics are not in the owner's plan. They are
    // real syllabus content, so they show — and the screen explains why they
    // repeat instead of letting it read as a duplication bug.
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Solar System')).toBeInTheDocument())
    expect(screen.getByText(/3 topics not\s+yet placed in a term/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Term 3' }))
    await waitFor(() => expect(screen.getByText('The Solar System')).toBeInTheDocument())
  })

  it('a subject with no authored plan gets its catalogue divided, and says so', async () => {
    // Mathematics has no owner-written scheme of work, so its sub-topics are
    // shared across the three terms in syllabus order. Term 1 opens on
    // Fractions; Number Bases is Term 2's work and must not be on this tab.
    renderSubject('/subjects/mathematics?term=1')
    await waitFor(() => {
      expect(screen.getByText('Operations on Fractions')).toBeInTheDocument()
    })
    // The claim is weaker than an authored plan's, and the screen makes it.
    expect(screen.getByText(/Suggested split/)).toBeInTheDocument()
    expect(screen.queryByText(/term plan for this subject\s+isn’t published yet/)).toBeNull()
    expect(screen.queryByText('Base Eight')).toBeNull()
    // The parent topic is the row's tag, without the catalogue's numbering.
    const row = screen.getByText('Operations on Fractions').closest('button')
    expect(within(row).getByText('Fractions')).toBeInTheDocument()
  })

  it('two sub-topics sharing a name are two rows, told apart by their topic', async () => {
    // Grade 7 Mathematics lists "Multiplication" under BOTH Fractions and
    // Decimals. Keying a row by its name made them one React key, which left
    // rows from the previous term standing after a tab switch.
    renderSubject('/subjects/mathematics?term=1')
    await waitFor(() => expect(screen.getAllByText('Multiplication')).toHaveLength(2))
    const tags = screen.getAllByText('Multiplication')
      .map((el) => within(el.closest('button')).getByText(/Fractions|Decimals/).textContent)
    expect(tags.sort()).toEqual(['Decimals', 'Fractions'])
    // Same for the screen reader: the name alone does not identify the row.
    expect(screen.getByRole('button', { name: /^Multiplication — Fractions/ })).toBeInTheDocument()
  })

  it('the three Mathematics tabs are different lists, in syllabus order', async () => {
    // The bug this fixes: every tab showing the same full syllabus.
    const titles = () => screen.getAllByRole('button')
      .filter((b) => b.className.includes('lhx-topic-row'))
      .map((b) => b.querySelector('.lhx-topic-name').textContent)

    renderSubject('/subjects/mathematics?term=1')
    await waitFor(() => expect(screen.getByText('Operations on Fractions')).toBeInTheDocument())
    const term1 = titles()

    fireEvent.click(screen.getByRole('tab', { name: 'Term 3' }))
    await waitFor(() => expect(screen.getByText('Mean, Mode and Median')).toBeInTheDocument())
    const term3 = titles()

    expect(term3).not.toEqual(term1)
    // Consecutive slices: nothing is taught twice.
    expect(term1.filter((t) => term3.includes(t))).toEqual([])
  })
})
