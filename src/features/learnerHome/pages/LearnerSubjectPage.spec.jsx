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
let mockResults = []
// The page reads through the scoped learner hook (its own module, so the
// authoring + admin data modules stay out of this route's chunk).
vi.mock('../../../hooks/useLearnerFirestore', () => ({
  useLearnerFirestore: () => ({
    getQuizzes: vi.fn(async () => mockQuizzes),
    getUserResults: vi.fn(async () => mockResults),
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
  mockResults = []
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
    const row = screen.getByText('The Digestive System').closest('.lhx-topic-row')
    expect(row).not.toBeNull()
    expect(within(row).getByText('Human Body')).toBeInTheDocument()
    // No note is published for it yet — the row says so instead of
    // leading nowhere.
    expect(within(row).getByText('Note coming soon')).toBeInTheDocument()
  })

  it('a topic with no note is not a control at all — no dead tap, no focus stop', async () => {
    // This test replaced one that asserted the row WAS a button carrying
    // aria-disabled. That was the defect, not the contract: the handler
    // returned silently without a note, so the row took focus, invited a
    // tap and answered with nothing — on most of the list, because most
    // topics have no note published yet.
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    const row = screen.getByText('The Digestive System').closest('.lhx-topic-row')
    expect(row.tagName).toBe('DIV')
    expect(row).not.toHaveAttribute('aria-disabled')
    expect(row.closest('button')).toBeNull()
    // Nothing in the row is reachable by keyboard either.
    expect(within(row).queryByRole('button')).toBeNull()
    // Tapping it navigates nowhere — the subject page is still on screen.
    fireEvent.click(row)
    expect(screen.getByText('The Digestive System')).toBeInTheDocument()
    expect(screen.queryByText(/^NOTE /)).toBeNull()
  })

  it('a topic row opens that topic\u2019s note', async () => {
    mockMaterials = [{
      id: 'n1', noteFormat: 'study', isPublished: true, grade: '7',
      subject: 'science', term: '1', topic: 'The Digestive System', title: 'The Digestive System',
    }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    const row = screen.getByText('The Digestive System').closest('button')
    // The strand is part of the accessible name: "Multiplication" alone
    // names two different rows on the Grade 7 Mathematics tab, and a
    // button collapses to its name for a screen reader.
    expect(row).toHaveAttribute('aria-label', expect.stringMatching(/^The Digestive System — Human Body/))
    fireEvent.click(row)
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
    const row = screen.getByText('Conjunctions — Joining Words').closest('.lhx-topic-row')
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

  it('opens the seeded note even when its title is worded differently', async () => {
    // The plan says "Diseases — Viruses & Bacteria"; the published note is
    // titled "2.1 Diseases". Equality and `title.includes(topic)` both miss
    // that, so the row used to say "Note coming soon" about a note sitting
    // in the library. The plan names its note, and the fuzzy matcher is
    // the fallback for everything else.
    mockMaterials = [{
      id: 'n7', noteFormat: 'study', isPublished: true, grade: '7',
      subject: 'science', title: '2.1 Diseases',
    }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('Diseases — Viruses & Bacteria')).toBeInTheDocument())
    const row = screen.getByText('Diseases — Viruses & Bacteria').closest('button')
    expect(within(row).queryByText('Note coming soon')).toBeNull()
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByText('NOTE n7')).toBeInTheDocument())
  })

  it('the two Fruits topics open their OWN notes, not each other’s', async () => {
    // "Fruits & Seeds as Food" (Term 1, Health) and "Fruits & Seeds"
    // (Term 3, Plants) share every meaningful word. Title similarity alone
    // sent both to whichever note came first in the array.
    mockMaterials = [
      { id: 'nA', noteFormat: 'study', isPublished: true, grade: '7', subject: 'science', title: '2.2 Fruits' },
      { id: 'nB', noteFormat: 'study', isPublished: true, grade: '7', subject: 'science', title: '4.3 Fruits and Seeds' },
    ]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('Fruits & Seeds as Food')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Fruits & Seeds as Food').closest('button'))
    await waitFor(() => expect(screen.getByText('NOTE nA')).toBeInTheDocument())
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
    const row = screen.getByText('Operations on Fractions').closest('.lhx-topic-row')
    expect(within(row).getByText('Fractions')).toBeInTheDocument()
  })

  it('two sub-topics sharing a name are two rows, told apart by their topic', async () => {
    // Grade 7 Mathematics lists "Multiplication" under BOTH Fractions and
    // Decimals. Keying a row by its name made them one React key, which left
    // rows from the previous term standing after a tab switch.
    renderSubject('/subjects/mathematics?term=1')
    await waitFor(() => expect(screen.getAllByText('Multiplication')).toHaveLength(2))
    const tags = screen.getAllByText('Multiplication')
      .map((el) => within(el.closest('.lhx-topic-row')).getByText(/Fractions|Decimals/).textContent)
    expect(tags.sort()).toEqual(['Decimals', 'Fractions'])
    // Neither row is a control here — no note is published for either — so
    // the strand that tells them apart is the visible tag. The accessible
    // NAME of an openable row is pinned in the note-opening test above.
  })

  it('the three Mathematics tabs are different lists, in syllabus order', async () => {
    // The bug this fixes: every tab showing the same full syllabus.
    const titles = () => [...document.querySelectorAll('.lhx-topic-row')]
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

  // ── Progress ──────────────────────────────────────────────────────
  //
  // The screen and the Home row are one measurement now
  // (`lib/subjectProgressCore`, `npm run test:subject-progress`). These pin
  // what that measurement is allowed to SAY.

  it('reports how many of THIS term\u2019s topics are done, not the year\u2019s', async () => {
    // Grade 7 Science Term 1 is three planned rows plus the unplaced ones.
    // The old page divided by the five all-year catalogue topics.
    mockQuizzes = [
      { id: 'q1', subject: 'science', grade: '7', topic: 'The Digestive System' },
      { id: 'q2', subject: 'science', grade: '7', topic: 'Fruits & Seeds as Food' },
    ]
    mockResults = [
      { id: 'r1', quizId: 'q1', subject: 'Integrated Science', percentage: 95, topicScores: {} },
    ]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    const rowCount = document.querySelectorAll('.lhx-topic-row').length
    // Not the five all-year catalogue topics the old page divided by.
    expect(rowCount).not.toBe(5)
    expect(screen.getByText(new RegExp(`1 of ${rowCount} topics done`))).toBeInTheDocument()
  })

  it('a term with nothing published says so instead of reporting zero', async () => {
    // "Nobody has built this yet" and "you have not started it" are different
    // facts that render identically as an empty bar.
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    expect(screen.getByText(/Material coming soon/)).toBeInTheDocument()
    expect(screen.queryByText(/topics done/)).toBeNull()
  })

  it('a quiz passed on a topic finishes it; a failed one does not', async () => {
    mockQuizzes = [
      { id: 'q-dig', subject: 'science', grade: '7', topic: 'The Digestive System' },
      { id: 'q-dis', subject: 'science', grade: '7', topic: 'Diseases \u2014 Viruses & Bacteria' },
    ]
    mockResults = [
      { id: 'r1', quizId: 'q-dig', subject: 'Integrated Science', percentage: 90, topicScores: {} },
      { id: 'r2', quizId: 'q-dis', subject: 'Integrated Science', percentage: 20, topicScores: {} },
    ]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    expect(screen.getByText(/1 of \d+ topics done/)).toBeInTheDocument()

    const passed = screen.getByText('The Digestive System').closest('.lhx-topic-row')
    expect(within(passed).getByText('Best score 90%')).toBeInTheDocument()
    const failed = screen.getByText('Diseases \u2014 Viruses & Bacteria').closest('.lhx-topic-row')
    expect(within(failed).getByText(/Best score 20% \u2014 60% finishes this topic/)).toBeInTheDocument()
  })

  it('an unrecognised topic label credits nothing', async () => {
    // `computeQuizScore` files every untagged question under 'General'. It
    // used to count as a covered topic, clamped up to the catalogue size.
    mockQuizzes = [{ id: 'q1', subject: 'science', grade: '7', topic: 'The Digestive System' }]
    mockResults = [{
      id: 'r1', quizId: 'q-unknown', subject: 'Integrated Science', percentage: 100,
      topicScores: {
        General: { correct: 9, total: 9 },
        Whatever: { correct: 9, total: 9 },
        Misc: { correct: 9, total: 9 },
        Another: { correct: 9, total: 9 },
        Untagged: { correct: 9, total: 9 },
        Spare: { correct: 9, total: 9 },
      },
    }]
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    // Six unrecognised labels used to clamp to full coverage. They reach no
    // row, so the term is exactly as untouched as it was.
    expect(screen.getByText(/Not started/)).toBeInTheDocument()
    expect(screen.queryByText(/topics done/)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('draws the term bar only once something has been started', async () => {
    renderSubject('/subjects/science?term=1')
    await waitFor(() => expect(screen.getByText('The Digestive System')).toBeInTheDocument())
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})
