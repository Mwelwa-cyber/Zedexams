import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import DiagramChoicePanel from './DiagramChoicePanel.jsx'
import { DiagramChoiceStatus, DIAGRAM_CHOICES } from '../../../utils/diagramChoiceStateMachine.js'

const baseProps = {
  open: true,
  diagramMeta: { kind: 'plant', caption: 'Parts of a plant', complexity: 'simple', confidence: 0.9 },
  cropObjectUrl: 'blob:original',
  choiceState: { status: DiagramChoiceStatus.PENDING, previewUrl: null, choice: null, errorMessage: null },
  onSelectChoice: vi.fn(),
  onConfirm: vi.fn(),
  onClose: vi.fn(),
}

test('renders all 5 choice buttons', () => {
  render(<DiagramChoicePanel {...baseProps} />)
  expect(screen.getByText(/Keep Original/i)).toBeInTheDocument()
  expect(screen.getByText(/Clean Original/i)).toBeInTheDocument()
  expect(screen.getByText(/Redraw Using AI/i)).toBeInTheDocument()
  expect(screen.getByText(/Replace with Better/i)).toBeInTheDocument()
  expect(screen.getByText(/Remove/i)).toBeInTheDocument()
})

test('calls onSelectChoice with correct id when button clicked', () => {
  const onSelectChoice = vi.fn()
  render(<DiagramChoicePanel {...baseProps} onSelectChoice={onSelectChoice} />)
  fireEvent.click(screen.getByText(/Redraw Using AI/i))
  expect(onSelectChoice).toHaveBeenCalledWith(DIAGRAM_CHOICES.REDRAW_AI)
})

test('shows spinner with role="status" when PREVIEWING', () => {
  render(<DiagramChoicePanel
    {...baseProps}
    choiceState={{ status: DiagramChoiceStatus.PREVIEWING, previewUrl: null, choice: DIAGRAM_CHOICES.REDRAW_AI, errorMessage: null }}
  />)
  expect(screen.getByRole('status')).toBeInTheDocument()
})

test('shows preview image and Confirm button when READY', () => {
  render(<DiagramChoicePanel
    {...baseProps}
    choiceState={{ status: DiagramChoiceStatus.READY, previewUrl: 'blob:preview', choice: DIAGRAM_CHOICES.REDRAW_AI, errorMessage: null }}
  />)
  expect(screen.getByAltText(/diagram preview/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
})

test('does not show Confirm button when PENDING', () => {
  render(<DiagramChoicePanel {...baseProps} />)
  expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull()
})

test('calls onClose when Close button clicked', () => {
  const onClose = vi.fn()
  render(<DiagramChoicePanel {...baseProps} onClose={onClose} />)
  fireEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalled()
})

test('renders nothing when open is false', () => {
  const { container } = render(<DiagramChoicePanel {...baseProps} open={false} />)
  expect(container.firstChild).toBeNull()
})
