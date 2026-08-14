import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ContextualUpgradeModal from './ContextualUpgradeModal'
import { resolveUpgradeScenario } from '../lib/upgradeScenarios'

// Presentational contract of the compact upgrade pop-up: scenario in,
// callbacks out. Scenarios come from the real resolver so copy and component
// can't drift apart.

function makeHandlers() {
  return {
    onPrimary: vi.fn(),
    onSecondary: vi.fn(),
    onDismiss: vi.fn(),
    onCompare: vi.fn(),
  }
}

function renderModal(scenario, handlers = makeHandlers()) {
  render(<ContextualUpgradeModal scenario={scenario} {...handlers} />)
  return handlers
}

describe('ContextualUpgradeModal', () => {
  beforeEach(() => {
    document.body.style.overflow = ''
  })

  it('renders nothing without a scenario', () => {
    renderModal(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders the scenario copy inside an accessible dialog', () => {
    const scenario = resolveUpgradeScenario('monthly-limit', { feature: 'lesson plans', tool: 'lesson_plan', resetDays: 4 })
    renderModal(scenario)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // The dialog is labelled by the scenario heading.
    expect(dialog).toHaveAttribute('aria-labelledby', 'cup-title')
    expect(screen.getByText(scenario.heading)).toHaveAttribute('id', 'cup-title')
    expect(screen.getByText(scenario.description)).toBeInTheDocument()
    expect(screen.getByText('Your free allowance resets in 4 days.')).toBeInTheDocument()
    expect(screen.getByText('Teacher Pro')).toBeInTheDocument()
    for (const benefit of scenario.benefits) {
      expect(screen.getByText(benefit)).toBeInTheDocument()
    }
  })

  it('never renders more than three benefits', () => {
    const scenario = {
      ...resolveUpgradeScenario('daily-cap', {}),
      benefits: ['one', 'two', 'three', 'four', 'five'],
    }
    renderModal(scenario)
    expect(screen.getByText('three')).toBeInTheDocument()
    expect(screen.queryByText('four')).toBeNull()
  })

  it('wires the primary, secondary and compare actions', () => {
    const scenario = resolveUpgradeScenario('monthly-limit', { feature: 'worksheets' })
    const handlers = renderModal(scenario)
    fireEvent.click(screen.getByRole('button', { name: scenario.primaryLabel }))
    expect(handlers.onPrimary).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: scenario.secondary.label }))
    expect(handlers.onSecondary).toHaveBeenCalledWith(scenario.secondary)
    fireEvent.click(screen.getByRole('button', { name: 'Compare plans' }))
    expect(handlers.onCompare).toHaveBeenCalledTimes(1)
  })

  it('omits the secondary button when the scenario has none', () => {
    const scenario = resolveUpgradeScenario('feature-locked', { feature: 'Worksheets' })
    renderModal(scenario)
    expect(screen.queryByRole('button', { name: /K25/ })).toBeNull()
  })

  it('offers safe exits: labelled close button, "Not now" and Escape', () => {
    const scenario = resolveUpgradeScenario('daily-cap', {})
    const handlers = renderModal(scenario)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(handlers.onDismiss).toHaveBeenCalledWith('close')
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(handlers.onDismiss).toHaveBeenCalledWith('not-now')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handlers.onDismiss).toHaveBeenCalledWith('esc')
  })

  it('locks body scroll while open and restores it on unmount', () => {
    const scenario = resolveUpgradeScenario('daily-cap', {})
    const { unmount } = render(
      <ContextualUpgradeModal scenario={scenario} {...makeHandlers()} />,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
