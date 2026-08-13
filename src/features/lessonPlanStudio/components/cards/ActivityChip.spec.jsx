import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityChip } from './ActivityChip'

describe('ActivityChip — rendering', () => {
  it('renders the label text', () => {
    render(<ActivityChip label="Group Discussion" />)
    expect(screen.getByText('Group Discussion')).toBeInTheDocument()
  })

  it('renders as an inline element', () => {
    const { container } = render(<ActivityChip label="Role Play" />)
    const chip = container.firstChild
    expect(chip.tagName).toBe('SPAN')
  })

  it('has the rounded-full pill class', () => {
    const { container } = render(<ActivityChip label="Debate" />)
    expect(container.firstChild.className).toMatch(/rounded-full/)
  })

  it('has the indigo background class', () => {
    const { container } = render(<ActivityChip label="Experiment" />)
    expect(container.firstChild.className).toMatch(/bg-indigo-100/)
  })

  it('has the indigo text colour class', () => {
    const { container } = render(<ActivityChip label="Fieldwork" />)
    expect(container.firstChild.className).toMatch(/text-indigo-800/)
  })

  it('has the text-xs size class', () => {
    const { container } = render(<ActivityChip label="Presentation" />)
    expect(container.firstChild.className).toMatch(/text-xs/)
  })

  it('renders different labels correctly', () => {
    const { rerender } = render(<ActivityChip label="First" />)
    expect(screen.getByText('First')).toBeInTheDocument()

    rerender(<ActivityChip label="Second" />)
    expect(screen.getByText('Second')).toBeInTheDocument()
  })
})
