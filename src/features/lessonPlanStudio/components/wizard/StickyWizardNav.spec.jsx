import { describe, it, expect } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { StickyWizardNav } from './StickyWizardNav.jsx'

// The floating-bar shrink relies on real window-scroll events + rAF, so drive
// them directly. Helper: set scrollY, dispatch a scroll, then flush the one
// rAF the hook schedules before its state update lands.
async function scrollTo(y) {
  await act(async () => {
    window.scrollY = y
    window.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
  })
}

describe('StickyWizardNav — floating shrink-on-scroll', () => {
  const baseProps = {
    currentStep: 0,
    canProceed: true,
    onBack: () => {},
    onNext: () => {},
    onGenerate: () => {},
    onSaveExit: () => {},
    onBackToReview: () => {},
  }

  it('renders full-size (not compact) at the top of the page', async () => {
    const { container } = render(<StickyWizardNav {...baseProps} />)
    await scrollTo(0)
    expect(container.querySelector('.lpw-nav')).not.toHaveClass('lpw-nav--compact')
  })

  it('shrinks to compact while scrolling down and grows back when scrolling up', async () => {
    const { container } = render(<StickyWizardNav {...baseProps} />)
    const nav = () => container.querySelector('.lpw-nav')

    await scrollTo(0)
    // Scroll well past the threshold — bar collapses.
    await scrollTo(400)
    expect(nav()).toHaveClass('lpw-nav--compact')

    // Scroll back up — bar grows again.
    await scrollTo(200)
    expect(nav()).not.toHaveClass('lpw-nav--compact')
  })

  it('never shrinks while a validation hint is showing (keeps the reason visible)', async () => {
    const { container } = render(
      <StickyWizardNav
        {...baseProps}
        canProceed={false}
        stepError="Pick a class before continuing."
      />,
    )
    await scrollTo(0)
    await scrollTo(400)
    expect(container.querySelector('.lpw-nav')).not.toHaveClass('lpw-nav--compact')
  })
})

describe('StickyWizardNav — centre progress block', () => {
  const baseProps = {
    currentStep: 0,
    canProceed: true,
    onBack: () => {},
    onNext: () => {},
    onGenerate: () => {},
    onSaveExit: () => {},
    onBackToReview: () => {},
  }

  it('shows the "Step n of 5 — Title" caption for the active step', () => {
    render(<StickyWizardNav {...baseProps} currentStep={0} />)
    expect(screen.getByText('Step 1 of 5 — Lesson Setup')).toBeInTheDocument()
  })

  it('fills the slim bar to n/5 of the width', () => {
    const { container, rerender } = render(<StickyWizardNav {...baseProps} currentStep={0} />)
    expect(container.querySelector('.lpw-nav-fill').style.width).toBe('20%')
    rerender(<StickyWizardNav {...baseProps} currentStep={2} />)
    expect(screen.getByText('Step 3 of 5 — Lesson Context')).toBeInTheDocument()
    expect(container.querySelector('.lpw-nav-fill').style.width).toBe('60%')
    rerender(<StickyWizardNav {...baseProps} currentStep={4} />)
    expect(container.querySelector('.lpw-nav-fill').style.width).toBe('100%')
  })
})
