/**
 * /notes — the revision hub.
 *
 * Two regressions pinned here:
 *
 * 1. The Conjunctions DEMO row is a fixture that anchors the English
 *    section only while no real English reader note exists. The
 *    pipeline's first real English note IS Conjunctions, so listing the
 *    demo beside it showed the same topic twice — a duplicate note, as
 *    far as a learner can tell.
 *
 * 2. The hub's root must be a fragment, not a wrapper div. `.lhx-page`
 *    is a flex column whose 20px gap spaces only DIRECT children; a
 *    wrapper div collapsed the whole hub into one unspaced stack, most
 *    visibly gluing the last subject's note row (Integrated Science —
 *    The Digestive System) onto the "Download all notes for offline"
 *    button below it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CONJUNCTIONS_BLOCKS } from '../reader/fixtures/conjunctionsDemo'

let notes = []

vi.mock('../hooks/useLearnerProfile', () => ({
  useLearnerProfile: () => ({ profile: { grade: 7 } }),
}))
vi.mock('../hooks/useLearnerNotes', () => ({
  useLearnerNotes: () => ({ allNotes: notes, loading: false, error: null, reload: vi.fn() }),
}))
vi.mock('../hooks/useNoteProgressMap', () => ({
  useNoteProgressMap: () => ({ progressById: {} }),
}))
vi.mock('../hooks/useDownloadedNotes', () => ({
  useDownloadedNotes: () => ({ downloadedIds: new Set(), refresh: vi.fn() }),
}))
vi.mock('../hooks/useOfflineNote', () => ({
  fetchNoteForCache: vi.fn(),
}))
// progress.js reaches the Firebase client at import time; only the
// status vocabulary is read here.
vi.mock('../lib/progress', () => ({
  NOTE_PROGRESS_STATUS: { NOT_STARTED: 'not-started', IN_PROGRESS: 'in-progress', COMPLETED: 'completed' },
}))
vi.mock('../../../offline/contentCache.js', () => ({
  downloadForOffline: vi.fn(),
}))
vi.mock('../../../utils/clientErrorReporting', () => ({
  reportClientError: vi.fn(),
}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const { LearnerNotesList } = await import('./LearnerNotesList')

/** A published reader-format note (blocks pass isReaderNote). */
const readerNote = (over = {}) => ({
  id: 'n1',
  title: 'A note',
  subject: 'english',
  noteFormat: 'study',
  blocks: CONJUNCTIONS_BLOCKS,
  ...over,
})

const renderHub = () =>
  render(
    <MemoryRouter initialEntries={['/notes']}>
      <LearnerNotesList />
    </MemoryRouter>,
  )

describe('LearnerNotesList — the revision hub', () => {
  beforeEach(() => {
    notes = []
  })

  it('shows the Conjunctions demo while no real English note exists', () => {
    notes = [readerNote({ id: 'sci-1', title: 'The Digestive System', subject: 'science' })]
    renderHub()
    expect(screen.getByText('Conjunctions — Joining Words')).toBeInTheDocument()
  })

  it('drops the demo the moment a real English reader note is published (no duplicate)', () => {
    notes = [
      readerNote({ id: 'eng-1', title: 'Conjunctions — the joining words 🔗', subject: 'english' }),
      readerNote({ id: 'sci-1', title: 'The Digestive System', subject: 'science' }),
    ]
    renderHub()
    // The real note is listed…
    expect(screen.getByText('Conjunctions — the joining words 🔗')).toBeInTheDocument()
    // …and the demo fixture is not beside it.
    expect(screen.queryByText('Conjunctions — Joining Words')).not.toBeInTheDocument()
    // Exactly one Conjunctions row in total.
    expect(screen.getAllByText(/conjunctions/i)).toHaveLength(1)
  })

  it('groups a science note under the grade’s "Integrated Science" label', () => {
    notes = [readerNote({ id: 'sci-1', title: 'The Digestive System', subject: 'science' })]
    renderHub()
    const section = screen.getByRole('region', { name: 'Integrated Science' })
    expect(section).toHaveClass('lhx-section')
    expect(section).toHaveTextContent('The Digestive System')
  })

  it('renders sections and the download-all button as page-level siblings (fragment root)', () => {
    // `.lhx-page` is a flex column with the design system's 20px gap, and
    // only DIRECT children receive it. If the hub regains a wrapper div,
    // the button re-attaches to the last note row with no spacing — the
    // reported "Digestive System glued to Download for offline" bug.
    notes = [readerNote({ id: 'sci-1', title: 'The Digestive System', subject: 'science' })]
    const { container } = renderHub()
    const section = screen.getByRole('region', { name: 'Integrated Science' })
    const downloadAll = screen.getByRole('button', { name: /download all notes for offline/i })
    expect(downloadAll.parentElement).toBe(section.parentElement)
    // No intermediate wrapper: page blocks mount directly in the shell's
    // flex column (the RTL container stands in for `.lhx-page` here).
    expect(section.parentElement).toBe(container)
  })
})
