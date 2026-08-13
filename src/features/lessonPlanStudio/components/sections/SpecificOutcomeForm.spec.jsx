import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SpecificOutcomeForm } from './SpecificOutcomeForm'

const OUTCOMES = [
  '10.1.3.1 Explain the zones of the atmosphere.',
  '10.1.3.2 Describe the composition of air.',
  '10.1.3.3 State the importance of each layer.',
]

function renderForm(props = {}) {
  const defaults = {
    subtopicRow: null,
    selectedOutcomes: [],
    onToggleOutcome: vi.fn(),
    disabled: false,
    ...props,
  }
  return { ...render(<SpecificOutcomeForm {...defaults} />), ...defaults }
}

// ── Placeholder states ─────────────────────────────────────────────────────────

describe('SpecificOutcomeForm — placeholder', () => {
  it('shows placeholder when subtopicRow is null', () => {
    renderForm({ subtopicRow: null })
    expect(
      screen.getByText('Select a subtopic to see specific outcomes.')
    ).toBeInTheDocument()
  })

  it('shows placeholder when specificOutcomes is empty', () => {
    renderForm({ subtopicRow: { specificOutcomes: [] } })
    expect(
      screen.getByText('Select a subtopic to see specific outcomes.')
    ).toBeInTheDocument()
  })

  it('does not render outcome buttons when subtopicRow is null', () => {
    renderForm({ subtopicRow: null })
    expect(screen.queryAllByRole('button', { pressed: false })).toHaveLength(0)
  })
})

// ── Outcome chips ──────────────────────────────────────────────────────────────

describe('SpecificOutcomeForm — outcome chips', () => {
  it('renders each outcome as a button when outcomes are available', () => {
    renderForm({ subtopicRow: { specificOutcomes: OUTCOMES } })
    for (const outcome of OUTCOMES) {
      expect(screen.getByRole('button', { name: outcome })).toBeInTheDocument()
    }
  })

  it('selected outcome has blue styling', () => {
    renderForm({
      subtopicRow: { specificOutcomes: OUTCOMES },
      selectedOutcomes: [OUTCOMES[0]],
    })
    const btn = screen.getByRole('button', { name: OUTCOMES[0] })
    expect(btn.className).toMatch(/border-blue-500/)
    expect(btn.className).toMatch(/bg-blue-50/)
    expect(btn.className).toMatch(/text-blue-900/)
  })

  it('selected outcome has aria-pressed="true"', () => {
    renderForm({
      subtopicRow: { specificOutcomes: OUTCOMES },
      selectedOutcomes: [OUTCOMES[0]],
    })
    const btn = screen.getByRole('button', { name: OUTCOMES[0] })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('unselected outcome has muted border and white background', () => {
    renderForm({
      subtopicRow: { specificOutcomes: OUTCOMES },
      selectedOutcomes: [],
    })
    const btn = screen.getByRole('button', { name: OUTCOMES[1] })
    expect(btn.className).toMatch(/border-\[#d9cfbe\]/)
    expect(btn.className).toMatch(/bg-white/)
  })

  it('unselected outcome has aria-pressed="false"', () => {
    renderForm({
      subtopicRow: { specificOutcomes: OUTCOMES },
      selectedOutcomes: [],
    })
    const btn = screen.getByRole('button', { name: OUTCOMES[1] })
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking an outcome calls onToggleOutcome with the correct string', () => {
    const onToggleOutcome = vi.fn()
    renderForm({
      subtopicRow: { specificOutcomes: OUTCOMES },
      selectedOutcomes: [],
      onToggleOutcome,
    })
    fireEvent.click(screen.getByRole('button', { name: OUTCOMES[2] }))
    expect(onToggleOutcome).toHaveBeenCalledWith(OUTCOMES[2])
    expect(onToggleOutcome).toHaveBeenCalledTimes(1)
  })

  it('shows helper text when outcomes are available', () => {
    renderForm({ subtopicRow: { specificOutcomes: OUTCOMES } })
    expect(
      screen.getByText('Select one or more outcomes for this lesson.')
    ).toBeInTheDocument()
  })

  it('does not show helper text when subtopicRow is null', () => {
    renderForm({ subtopicRow: null })
    expect(
      screen.queryByText('Select one or more outcomes for this lesson.')
    ).not.toBeInTheDocument()
  })
})

// ── Status dot ─────────────────────────────────────────────────────────────────

describe('SpecificOutcomeForm — status dot', () => {
  it('status dot is grey when selectedOutcomes is empty', () => {
    const { container } = renderForm({ selectedOutcomes: [] })
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).toBeInTheDocument()
    expect(container.querySelector('.bg-green-500')).not.toBeInTheDocument()
  })

  it('status dot is green when at least one outcome is selected', () => {
    const { container } = renderForm({
      subtopicRow: { specificOutcomes: OUTCOMES },
      selectedOutcomes: [OUTCOMES[0]],
    })
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).not.toBeInTheDocument()
  })
})

// ── Collapse / expand ──────────────────────────────────────────────────────────

describe('SpecificOutcomeForm — collapse/expand', () => {
  it('body is visible by default (starts open)', () => {
    renderForm({ subtopicRow: null })
    expect(
      screen.getByText('Select a subtopic to see specific outcomes.')
    ).toBeInTheDocument()
  })

  it('hides body after clicking the toggle button', () => {
    renderForm({ subtopicRow: null })
    const toggle = screen.getByRole('button', { name: /specific outcome/i })
    fireEvent.click(toggle)
    expect(
      screen.queryByText('Select a subtopic to see specific outcomes.')
    ).not.toBeInTheDocument()
  })

  it('shows body again after a second click', () => {
    renderForm({ subtopicRow: null })
    const toggle = screen.getByRole('button', { name: /specific outcome/i })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(
      screen.getByText('Select a subtopic to see specific outcomes.')
    ).toBeInTheDocument()
  })

  it('toggle button exposes aria-expanded', () => {
    renderForm({ subtopicRow: null })
    const toggle = screen.getByRole('button', { name: /specific outcome/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

// ── Disabled state ─────────────────────────────────────────────────────────────

describe('SpecificOutcomeForm — disabled state', () => {
  it('applies pointer-events-none and opacity-50 when disabled', () => {
    const { container } = renderForm({ disabled: true })
    const root = container.firstChild
    expect(root.className).toMatch(/pointer-events-none/)
    expect(root.className).toMatch(/opacity-50/)
  })

  it('does NOT apply disabled classes when enabled', () => {
    const { container } = renderForm({ disabled: false })
    const root = container.firstChild
    expect(root.className).not.toMatch(/pointer-events-none/)
    expect(root.className).not.toMatch(/opacity-50/)
  })

  it('toggle button is disabled when disabled prop is true', () => {
    renderForm({ disabled: true })
    expect(screen.getByRole('button', { name: /specific outcome/i })).toBeDisabled()
  })
})
