import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SbaWorkflowNote, { SBA_WORKFLOW_STEPS } from './SbaWorkflowNote.jsx'

const STORAGE_KEY = 'examprep:sba:workflow-note-dismissed'

function renderNote(props = {}) {
  return render(
    <MemoryRouter>
      <SbaWorkflowNote {...props} />
    </MemoryRouter>,
  )
}

describe('SbaWorkflowNote', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the ECZ essentials and all three workflow steps', () => {
    renderNote()
    expect(screen.getByRole('region', { name: /how school based assessment works/i })).toBeInTheDocument()
    expect(screen.getByText(/30% of the final Grade 7 mark/i)).toBeInTheDocument()
    for (const step of SBA_WORKFLOW_STEPS) {
      expect(screen.getByText(new RegExp(step.title, 'i'))).toBeInTheDocument()
    }
    // Each step links to its surface.
    expect(screen.getByRole('link', { name: /Create tasks/i })).toHaveAttribute('href', '/teacher/generate/sba')
    expect(screen.getByRole('link', { name: /Record marks/i })).toHaveAttribute('href', '/teacher/generate/sba-tracker')
    expect(screen.getByRole('link', { name: /Track coverage/i })).toHaveAttribute('href', '/teacher/generate/sba-planner')
  })

  it('marks the current step with "You’re here" and aria-current', () => {
    renderNote({ current: 'tracker' })
    expect(screen.getByText(/you’re here/i)).toBeInTheDocument()
    const current = screen.getByRole('link', { name: /Record marks/i })
    expect(current).toHaveAttribute('aria-current', 'page')
    // Non-current steps are not flagged.
    expect(screen.getByRole('link', { name: /Create tasks/i })).not.toHaveAttribute('aria-current')
  })

  it('dismisses on "Got it" and remembers it in localStorage', () => {
    const { container } = renderNote()
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(container).toBeEmptyDOMElement()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('renders nothing when already dismissed', () => {
    localStorage.setItem(STORAGE_KEY, '1')
    const { container } = renderNote()
    expect(container).toBeEmptyDOMElement()
  })
})
