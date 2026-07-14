import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TeachingAssignmentChangeNotice from './TeachingAssignmentChangeNotice'
import StudioAssignmentChangeNotice from './StudioAssignmentChangeNotice'

function fireStorage(uid, seed) {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: `zedexams:active-seed:${uid}`,
      newValue: seed ? JSON.stringify(seed) : null,
    }))
  })
}

describe('TeachingAssignmentChangeNotice (presentational)', () => {
  it('names both assignments and offers Switch / Keep', () => {
    render(<TeachingAssignmentChangeNotice fromLabel="Grade 4 · Mathematics" toLabel="Grade 5 · Mathematics" onSwitch={() => {}} onKeep={() => {}} />)
    expect(screen.getByText(/your active teaching assignment has changed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /switch to grade 5 · mathematics/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep grade 4 · mathematics/i })).toBeInTheDocument()
  })

  it('is honest that Switch keeps typed content but resets structured selections', () => {
    render(<TeachingAssignmentChangeNotice fromLabel="Grade 4 · Mathematics" toLabel="Grade 5 · Mathematics" onSwitch={() => {}} onKeep={() => {}} />)
    expect(screen.getByText(/your typed content will remain/i)).toBeInTheDocument()
    expect(screen.getByText(/grade, subject, topic and curriculum selections will update/i)).toBeInTheDocument()
    // Never claims work was "saved".
    expect(screen.queryByText(/has been saved/i)).toBeNull()
  })

  it('shows the read-only variant for an existing document (no Switch)', () => {
    render(<TeachingAssignmentChangeNotice fromLabel="Grade 4 · Mathematics" toLabel="Grade 5 · Mathematics" existingDocument onSwitch={() => {}} onKeep={() => {}} />)
    expect(screen.getByText(/its teaching assignment stays unchanged/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /switch/i })).toBeNull()
  })

  it('renders nothing without a target label', () => {
    const { container } = render(<TeachingAssignmentChangeNotice fromLabel="x" toLabel="" onSwitch={() => {}} onKeep={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('StudioAssignmentChangeNotice (container)', () => {
  const current = { grade: 'G4', subject: 'mathematics', curriculum: 'cbc' }

  it('surfaces a cross-tab change and applies it on Switch', async () => {
    const onApply = vi.fn()
    render(<StudioAssignmentChangeNotice uid="u1" currentSeed={current} onApply={onApply} />)
    expect(screen.queryByText(/changed/i)).toBeNull()

    fireStorage('u1', { grade: 'G5', subject: 'mathematics', curriculum: 'cbc' })
    expect(await screen.findByText(/your active teaching assignment has changed/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /switch to grade 5/i }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ grade: 'G5', subject: 'mathematics' }))
    expect(screen.queryByText(/your active teaching assignment has changed/i)).toBeNull()
  })

  it('ignores a change to the SAME assignment', () => {
    render(<StudioAssignmentChangeNotice uid="u1" currentSeed={current} onApply={vi.fn()} />)
    fireStorage('u1', { grade: 'G4', subject: 'mathematics', curriculum: 'cbc' })
    expect(screen.queryByText(/changed/i)).toBeNull()
  })

  it('Keep dismisses without applying', async () => {
    const onApply = vi.fn()
    render(<StudioAssignmentChangeNotice uid="u1" currentSeed={current} onApply={onApply} />)
    fireStorage('u1', { grade: 'G5', subject: 'english', curriculum: 'cbc' })
    expect(await screen.findByText(/your active teaching assignment has changed/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /keep grade 4/i }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByText(/your active teaching assignment has changed/i)).toBeNull()
  })
})
