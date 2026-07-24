import { describe, it, expect } from 'vitest'
import { act, render } from '@testing-library/react'
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
