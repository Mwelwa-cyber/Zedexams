import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CurriculumPicker } from './CurriculumPicker'

describe('CurriculumPicker — rendering', () => {
  it('renders the CURRICULUM section label', () => {
    render(<CurriculumPicker curriculumMode={null} onSelect={vi.fn()} />)
    // Use exact text to avoid matching the button labels that also contain "Curriculum"
    expect(screen.getByText('Curriculum')).toBeInTheDocument()
  })

  it('renders the CBC button', () => {
    render(<CurriculumPicker curriculumMode={null} onSelect={vi.fn()} />)
    expect(
      screen.getByRole('radio', { name: /competency-based curriculum/i }),
    ).toBeInTheDocument()
  })

  it('renders the Previous Curriculum button', () => {
    render(<CurriculumPicker curriculumMode={null} onSelect={vi.fn()} />)
    expect(
      screen.getByRole('radio', { name: /previous curriculum/i }),
    ).toBeInTheDocument()
  })

  it('wraps buttons in a radiogroup with label "Curriculum"', () => {
    render(<CurriculumPicker curriculumMode={null} onSelect={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: /curriculum/i })).toBeInTheDocument()
  })
})

describe('CurriculumPicker — aria-checked state', () => {
  it('both buttons are unchecked when curriculumMode is null', () => {
    render(<CurriculumPicker curriculumMode={null} onSelect={vi.fn()} />)
    const cbc  = screen.getByRole('radio', { name: /competency-based curriculum/i })
    const prev = screen.getByRole('radio', { name: /previous curriculum/i })
    expect(cbc).toHaveAttribute('aria-checked', 'false')
    expect(prev).toHaveAttribute('aria-checked', 'false')
  })

  it('CBC button is checked when curriculumMode is "cbc"', () => {
    render(<CurriculumPicker curriculumMode="cbc" onSelect={vi.fn()} />)
    const cbc  = screen.getByRole('radio', { name: /competency-based curriculum/i })
    const prev = screen.getByRole('radio', { name: /previous curriculum/i })
    expect(cbc).toHaveAttribute('aria-checked', 'true')
    expect(prev).toHaveAttribute('aria-checked', 'false')
  })

  it('Previous button is checked when curriculumMode is "previous"', () => {
    render(<CurriculumPicker curriculumMode="previous" onSelect={vi.fn()} />)
    const cbc  = screen.getByRole('radio', { name: /competency-based curriculum/i })
    const prev = screen.getByRole('radio', { name: /previous curriculum/i })
    expect(cbc).toHaveAttribute('aria-checked', 'false')
    expect(prev).toHaveAttribute('aria-checked', 'true')
  })
})

describe('CurriculumPicker — onSelect callback', () => {
  it('calls onSelect("cbc") when the CBC button is clicked', () => {
    const onSelect = vi.fn()
    render(<CurriculumPicker curriculumMode={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('radio', { name: /competency-based curriculum/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('cbc')
  })

  it('calls onSelect("previous") when the Previous button is clicked', () => {
    const onSelect = vi.fn()
    render(<CurriculumPicker curriculumMode={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('radio', { name: /previous curriculum/i }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('previous')
  })

  it('calls onSelect again when a different mode is clicked while one is already selected', () => {
    const onSelect = vi.fn()
    render(<CurriculumPicker curriculumMode="cbc" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('radio', { name: /previous curriculum/i }))
    expect(onSelect).toHaveBeenCalledWith('previous')
  })

  it('calls onSelect even when the already-selected button is clicked again', () => {
    const onSelect = vi.fn()
    render(<CurriculumPicker curriculumMode="cbc" onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('radio', { name: /competency-based curriculum/i }))
    expect(onSelect).toHaveBeenCalledWith('cbc')
  })
})
