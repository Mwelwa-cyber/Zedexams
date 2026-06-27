import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LearningEnvironmentForm } from './LearningEnvironmentForm'

function renderForm(props = {}) {
  const defaults = {
    learningEnvironments: [],
    onToggle: vi.fn(),
    disabled: false,
    ...props,
  }
  return { ...render(<LearningEnvironmentForm {...defaults} />), onToggle: defaults.onToggle }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('LearningEnvironmentForm — rendering', () => {
  it('renders the "Learning Environment" heading', () => {
    renderForm()
    expect(screen.getByText('Learning Environment')).toBeInTheDocument()
  })

  it('renders all three checkbox labels', () => {
    renderForm()
    expect(screen.getByLabelText(/natural environment/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/artificial environment/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/technological environment/i)).toBeInTheDocument()
  })

  it('renders checkboxes in the correct order (Natural, Artificial, Technological)', () => {
    renderForm()
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    // Natural first
    expect(checkboxes[0]).toHaveAttribute('id', 'lef-natural')
    expect(checkboxes[1]).toHaveAttribute('id', 'lef-artificial')
    expect(checkboxes[2]).toHaveAttribute('id', 'lef-technological')
  })

  it('renders descriptions for each environment', () => {
    renderForm()
    expect(screen.getByText('Outdoors, field trips, community')).toBeInTheDocument()
    expect(screen.getByText('Classroom, lab, workshop')).toBeInTheDocument()
    expect(screen.getByText('Computer, TV, projector')).toBeInTheDocument()
  })
})

// ── Checked state ─────────────────────────────────────────────────────────────

describe('LearningEnvironmentForm — checked state', () => {
  it('all checkboxes are unchecked when learningEnvironments is empty', () => {
    renderForm({ learningEnvironments: [] })
    screen.getAllByRole('checkbox').forEach((cb) => {
      expect(cb).not.toBeChecked()
    })
  })

  it('Natural checkbox is checked when "Natural" is in learningEnvironments', () => {
    renderForm({ learningEnvironments: ['Natural'] })
    expect(screen.getByLabelText(/natural environment/i)).toBeChecked()
    expect(screen.getByLabelText(/artificial environment/i)).not.toBeChecked()
    expect(screen.getByLabelText(/technological environment/i)).not.toBeChecked()
  })

  it('Artificial checkbox is checked when "Artificial" is in learningEnvironments', () => {
    renderForm({ learningEnvironments: ['Artificial'] })
    expect(screen.getByLabelText(/artificial environment/i)).toBeChecked()
    expect(screen.getByLabelText(/natural environment/i)).not.toBeChecked()
  })

  it('Technological checkbox is checked when "Technological" is in learningEnvironments', () => {
    renderForm({ learningEnvironments: ['Technological'] })
    expect(screen.getByLabelText(/technological environment/i)).toBeChecked()
  })

  it('multiple checkboxes can be checked simultaneously', () => {
    renderForm({ learningEnvironments: ['Natural', 'Technological'] })
    expect(screen.getByLabelText(/natural environment/i)).toBeChecked()
    expect(screen.getByLabelText(/artificial environment/i)).not.toBeChecked()
    expect(screen.getByLabelText(/technological environment/i)).toBeChecked()
  })

  it('all three checkboxes are checked when all are selected', () => {
    renderForm({ learningEnvironments: ['Natural', 'Artificial', 'Technological'] })
    screen.getAllByRole('checkbox').forEach((cb) => {
      expect(cb).toBeChecked()
    })
  })
})

// ── onToggle callbacks ────────────────────────────────────────────────────────

describe('LearningEnvironmentForm — onToggle callbacks', () => {
  it('calls onToggle("Natural") when Natural checkbox is clicked', () => {
    const { onToggle } = renderForm()
    fireEvent.click(screen.getByLabelText(/natural environment/i))
    expect(onToggle).toHaveBeenCalledWith('Natural')
  })

  it('calls onToggle("Artificial") when Artificial checkbox is clicked', () => {
    const { onToggle } = renderForm()
    fireEvent.click(screen.getByLabelText(/artificial environment/i))
    expect(onToggle).toHaveBeenCalledWith('Artificial')
  })

  it('calls onToggle("Technological") when Technological checkbox is clicked', () => {
    const { onToggle } = renderForm()
    fireEvent.click(screen.getByLabelText(/technological environment/i))
    expect(onToggle).toHaveBeenCalledWith('Technological')
  })

  it('calls onToggle with the short value, not the full label', () => {
    const { onToggle } = renderForm()
    fireEvent.click(screen.getByLabelText(/natural environment/i))
    // Must be the short form "Natural", not "Natural Environment"
    expect(onToggle).toHaveBeenCalledWith('Natural')
    expect(onToggle).not.toHaveBeenCalledWith('Natural Environment')
  })
})

// ── Status dot ────────────────────────────────────────────────────────────────

describe('LearningEnvironmentForm — status dot', () => {
  it('shows a grey dot when no environment is selected', () => {
    const { container } = render(
      <LearningEnvironmentForm
        learningEnvironments={[]}
        onToggle={vi.fn()}
        disabled={false}
      />,
    )
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).toBeInTheDocument()
    expect(container.querySelector('.bg-green-500')).not.toBeInTheDocument()
  })

  it('shows a green dot when at least one environment is selected', () => {
    const { container } = render(
      <LearningEnvironmentForm
        learningEnvironments={['Natural']}
        onToggle={vi.fn()}
        disabled={false}
      />,
    )
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).not.toBeInTheDocument()
  })

  it('shows a green dot when all three environments are selected', () => {
    const { container } = render(
      <LearningEnvironmentForm
        learningEnvironments={['Natural', 'Artificial', 'Technological']}
        onToggle={vi.fn()}
        disabled={false}
      />,
    )
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
  })
})

// ── Collapse / expand ─────────────────────────────────────────────────────────

describe('LearningEnvironmentForm — collapse/expand', () => {
  it('body is visible by default (starts open)', () => {
    renderForm()
    expect(screen.getByLabelText(/natural environment/i)).toBeInTheDocument()
  })

  it('hides the body after clicking the toggle button', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /learning environment/i })
    fireEvent.click(toggle)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('shows the body again after a second click', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /learning environment/i })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
  })

  it('toggle button has aria-expanded="true" when open', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /learning environment/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('toggle button has aria-expanded="false" after collapsing', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /learning environment/i })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

// ── Disabled state ────────────────────────────────────────────────────────────

describe('LearningEnvironmentForm — disabled state', () => {
  it('applies pointer-events-none and opacity-50 on the root when disabled', () => {
    const { container } = render(
      <LearningEnvironmentForm
        learningEnvironments={[]}
        onToggle={vi.fn()}
        disabled={true}
      />,
    )
    const root = container.firstChild
    expect(root.className).toMatch(/pointer-events-none/)
    expect(root.className).toMatch(/opacity-50/)
  })

  it('does NOT apply disabled classes when enabled', () => {
    const { container } = render(
      <LearningEnvironmentForm
        learningEnvironments={[]}
        onToggle={vi.fn()}
        disabled={false}
      />,
    )
    const root = container.firstChild
    expect(root.className).not.toMatch(/pointer-events-none/)
    expect(root.className).not.toMatch(/opacity-50/)
  })

  it('toggle button is disabled when disabled prop is true', () => {
    render(
      <LearningEnvironmentForm
        learningEnvironments={[]}
        onToggle={vi.fn()}
        disabled={true}
      />,
    )
    expect(screen.getByRole('button', { name: /learning environment/i })).toBeDisabled()
  })
})
