/**
 * The three block types the Digestive System note needed — tapexplore,
 * flow and startend. What is worth pinning is the interaction and the
 * degradation, not the styling: a card must open, focus must come back,
 * and an item whose picture has not been drawn yet must still be
 * tappable rather than quietly dropping a piece of the syllabus.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ReaderBlock from './ReaderBlock'

const ORGANS = {
  type: 'tapexplore',
  items: [
    { key: 'mouth', name: 'Mouth (teeth & tongue)', url: '/notes/g7-sci-1-1-mouth.jpg', role: 'Digestion STARTS here!' },
    { key: 'small', name: 'Small intestine', url: '/notes/g7-sci-1-1-small-intestine.jpg', role: 'Nutrients are absorbed into the blood.', parts: '2 parts: ① Duodenum; ② Ileum.' },
    { key: 'nopic', name: 'Appendix', role: 'No picture drawn for this one yet.' },
  ],
}

const draw = (block) => render(<MemoryRouter><ReaderBlock block={block} /></MemoryRouter>)

describe('tapexplore', () => {
  it('renders a card per item and opens a dialog with the picture and role', () => {
    draw(ORGANS)
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Mouth/ }))
    const sheet = screen.getByRole('dialog', { name: 'Mouth (teeth & tongue)' })
    expect(within(sheet).getByText('Digestion STARTS here!')).toBeInTheDocument()
    expect(within(sheet).getByRole('img', { name: 'Mouth (teeth & tongue)' })).toBeInTheDocument()
  })

  it('shows the extra `parts` line only for the items that have one', () => {
    draw(ORGANS)
    fireEvent.click(screen.getByRole('button', { name: /Small intestine/ }))
    expect(screen.getByText(/Duodenum/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Got it/ }))
    fireEvent.click(screen.getByRole('button', { name: /Mouth/ }))
    expect(screen.queryByText(/Duodenum/)).toBeNull()
  })

  it('an item with no picture still opens — the role text is the lesson', () => {
    // A missing image must not make a syllabus item untappable.
    draw(ORGANS)
    fireEvent.click(screen.getByRole('button', { name: /Appendix/ }))
    expect(screen.getByRole('dialog', { name: 'Appendix' })).toBeInTheDocument()
    expect(screen.getByText('No picture drawn for this one yet.')).toBeInTheDocument()
  })

  it('closes on Escape and on the backdrop, and returns focus to the card', () => {
    draw(ORGANS)
    const card = screen.getByRole('button', { name: /Mouth/ })
    fireEvent.click(card)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // Losing your place in a grid of eight is disorienting.
    expect(document.activeElement).toBe(card)

    fireEvent.click(card)
    fireEvent.click(screen.getByRole('presentation'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders nothing rather than an empty grid when it has no items', () => {
    const { container } = draw({ type: 'tapexplore', items: [] })
    expect(container.querySelector('.lhx-organ-grid')).toBeNull()
  })
})

describe('flow', () => {
  it('numbers the steps in order and keeps the trailing note', () => {
    const { container } = draw({
      type: 'flow',
      steps: [
        { text: 'Mouth', note: 'teeth chew, saliva softens' },
        { text: 'Stomach', note: 'churns food into a paste' },
        { text: 'Anus' },
      ],
    })
    const steps = container.querySelectorAll('.lhx-flow-step')
    expect(steps).toHaveLength(3)
    expect(steps[0].textContent).toContain('1')
    expect(steps[0].textContent).toContain('teeth chew')
    // An ordered list, so it reads correctly without the arrows.
    expect(container.querySelector('ol.lhx-flow')).toBeTruthy()
    // A step with no note renders without a dangling dash.
    expect(steps[2].textContent.trim()).toBe('3Anus')
  })
})

describe('startend', () => {
  it('draws both boxes with their default labels', () => {
    draw({ type: 'startend', start: '👄 Mouth', end: '🌀 Small intestine' })
    expect(screen.getByText('STARTS IN')).toBeInTheDocument()
    expect(screen.getByText('ENDS IN')).toBeInTheDocument()
    expect(screen.getByText('👄 Mouth')).toBeInTheDocument()
    expect(screen.getByText('🌀 Small intestine')).toBeInTheDocument()
  })
})
