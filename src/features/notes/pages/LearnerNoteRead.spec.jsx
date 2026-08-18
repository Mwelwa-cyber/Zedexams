/**
 * /notes/:id — the two doorways onto ONE note.
 *
 * The guarantee under test is the one that is invisible from the screen:
 * reviewing is not re-learning, so Revise mode must not write reading
 * progress. Revise renders the whole note flat, so a learner who scrolls
 * it to the bottom would otherwise be recorded as having completed a
 * guided pass they never made — and the hub would then tell them they
 * had learned a topic nobody taught them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { CONJUNCTIONS_BLOCKS } from '../reader/fixtures/conjunctionsDemo'

const NOTE = {
  id: 'note-1',
  title: 'Conjunctions — Joining Words',
  subject: 'English',
  grade: '7',
  noteFormat: 'study',
  blocks: CONJUNCTIONS_BLOCKS,
}

const recordProgress = vi.fn()

vi.mock('../hooks/useOfflineNote', () => ({
  useOfflineNote: () => ({ note: NOTE, loading: false, error: null }),
  fetchNoteForCache: vi.fn(),
}))
vi.mock('../hooks/useRecordNoteProgress', () => ({
  useRecordNoteProgress: (note) => recordProgress(note),
}))
vi.mock('../components/SaveOfflineButton', () => ({
  SaveOfflineButton: () => null,
}))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const { LearnerNoteRead } = await import('./LearnerNoteRead')

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/notes/:id" element={<LearnerNoteRead />} /></Routes>
    </MemoryRouter>,
  )
}

/** The note passed to the progress recorder on the latest render. */
const trackedNote = () => recordProgress.mock.calls.at(-1)?.[0]

describe('LearnerNoteRead — one note, two doorways', () => {
  beforeEach(() => {
    recordProgress.mockClear()
    window.localStorage.clear()
  })

  it('records reading progress in Learn mode', () => {
    renderAt('/notes/note-1')
    expect(trackedNote()).toBe(NOTE)
  })

  it('records nothing in Revise mode', () => {
    renderAt('/notes/note-1?mode=revise')
    expect(trackedNote()).toBeNull()
  })

  it('stops recording the moment the learner flips to Revise', () => {
    renderAt('/notes/note-1')
    expect(trackedNote()).toBe(NOTE)
    fireEvent.click(screen.getByRole('tab', { name: /revise/i }))
    expect(trackedNote()).toBeNull()
  })

  it('resumes recording when the learner goes back to Learn', () => {
    renderAt('/notes/note-1?mode=revise')
    fireEvent.click(screen.getByRole('tab', { name: /learn/i }))
    expect(trackedNote()).toBe(NOTE)
  })

  it('opens both doorways onto the same words', () => {
    // Not two copies: the Revise view carries the note's own paragraph.
    renderAt('/notes/note-1?mode=revise')
    expect(screen.getByText(/works like glue/)).toBeInTheDocument()
    expect(screen.getAllByText(/KEY POINTS/).length).toBe(3)
  })

  it('remembers how far the Learn pass got, across visits', () => {
    const first = renderAt('/notes/note-1')
    fireEvent.click(screen.getByRole('button', { name: /let's begin/i }))
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    first.unmount()

    // Reopening from the Notes tab offers to finish the pass, and the
    // guided view resumes where it stopped rather than at section 1.
    renderAt('/notes/note-1?mode=revise')
    fireEvent.click(screen.getByRole('button', { name: /learn this properly/i }))
    expect(screen.getByText(/Subordinating — one idea/)).toBeInTheDocument()
    expect(screen.queryByText(/Conjunction pairs — words that work as a team/)).toBeNull()
  })
})
