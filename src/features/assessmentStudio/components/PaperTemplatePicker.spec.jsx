import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import PaperTemplatePicker from './PaperTemplatePicker.jsx'
import { PAPER_TEMPLATES, templateStats } from '../lib/paperTemplates.js'

describe('PaperTemplatePicker', () => {
  let onClose, onPick
  beforeEach(() => {
    onClose = vi.fn()
    onPick = vi.fn()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<PaperTemplatePicker open={false} onClose={onClose} onPick={onPick} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a card for every template with its name and stats', () => {
    render(<PaperTemplatePicker open onClose={onClose} onPick={onPick} />)
    for (const template of PAPER_TEMPLATES) {
      const card = screen.getByRole('button', { name: new RegExp(template.name, 'i') })
      expect(card).toBeInTheDocument()
      const stats = templateStats(template)
      // Each card states its question + marks counts.
      expect(within(card).getByText(new RegExp(`${stats.questionCount} questions`))).toBeInTheDocument()
      expect(within(card).getByText(new RegExp(`${stats.totalMarks} marks`))).toBeInTheDocument()
    }
  })

  it('calls onPick with the chosen template', () => {
    render(<PaperTemplatePicker open onClose={onClose} onPick={onPick} />)
    const endOfTerm = PAPER_TEMPLATES.find((t) => t.id === 'end-of-term')
    fireEvent.click(screen.getByRole('button', { name: new RegExp(endOfTerm.name, 'i') }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(endOfTerm)
  })

  it('closes on the close button and on Escape', () => {
    render(<PaperTemplatePicker open onClose={onClose} onPick={onPick} />)
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
