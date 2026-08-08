import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GroundingChip from './GroundingChip.jsx'

// Three states, and the test exists for the third. "Grounded" and "not
// grounded" are easy to get right; the failure that would ship quietly is
// showing NOTHING when the syllabus could not be read, which a teacher reads as
// "fine" — the one reading that is never true.

describe('GroundingChip', () => {
  it('shows the outcome count, and lists the outcomes on demand', () => {
    render(<GroundingChip grounding={{
      grounded: true,
      label: 'Grounded in Grade 4 Integrated Science syllabus · 2 outcomes',
      outcomes: ['describe the parts of a flower', 'name the parts of a plant'],
      message: '',
    }} />)
    expect(screen.getByText(/2 outcomes/)).toBeInTheDocument()
    // A count nobody can expand is a claim; the list is the evidence.
    expect(screen.queryByText(/describe the parts of a flower/)).toBeNull()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText(/describe the parts of a flower/)).toBeInTheDocument()
  })

  it('shows the amber notice when the topic has no syllabus data', () => {
    render(<GroundingChip grounding={{
      grounded: false,
      unavailable: false,
      label: 'Not grounded in a syllabus',
      message: 'No syllabus data found for this topic — notes were generated from '
        + 'general curriculum knowledge; review carefully before use.',
      outcomes: [],
    }} />)
    expect(screen.getByText('Not grounded in a syllabus')).toBeInTheDocument()
    expect(screen.getByText(/review carefully before use/)).toBeInTheDocument()
  })

  it('distinguishes "could not read the syllabus" from "there is none"', () => {
    render(<GroundingChip grounding={{
      grounded: false,
      unavailable: true,
      label: 'Syllabus check unavailable',
      message: 'We could not read the syllabus while writing these notes, so they '
        + 'are not grounded in it.',
      outcomes: [],
    }} />)
    expect(screen.getByText('Syllabus check unavailable')).toBeInTheDocument()
    // Telling a teacher their curriculum has no data for a topic it does have
    // data for is telling them something false about their own syllabus.
    expect(screen.queryByText(/No syllabus data found/)).toBeNull()
  })

  it('surfaces a voice or scope problem the repair pass could not fix', () => {
    render(<GroundingChip
      grounding={{ grounded: true, label: 'Grounded · 1 outcome', outcomes: ['x'], message: '' }}
      checks={{
        voiceClean: false,
        voiceMessage: '2 teacher-directed phrases found in 1 section',
        scopeClean: false,
        scopeMessage: 'beyond-grade concepts: jejunum',
      }}
    />)
    expect(screen.getByText(/2 teacher-directed phrases/)).toBeInTheDocument()
    expect(screen.getByText(/jejunum/)).toBeInTheDocument()
  })

  it('renders nothing at all when there is no grounding to report', () => {
    const { container } = render(<GroundingChip grounding={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
