/**
 * TeacherWorkspaceSection — the glass-tile markup contract.
 *
 * The CSS keys everything off these hooks, so the spec pins them:
 *  - each category section carries its accent modifier class (that class is
 *    what sets --ws-accent / the panel tint for every tile inside it);
 *  - every tile carries a decorative sheen span (aria-hidden — it must never
 *    reach the accessibility tree);
 *  - the expander section gets the neutral "more" modifier.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import TeacherWorkspaceSection from './TeacherWorkspaceSection'

const renderSection = (props = {}) =>
  render(
    <MemoryRouter>
      <TeacherWorkspaceSection {...props} />
    </MemoryRouter>,
  )

describe('TeacherWorkspaceSection glass tiles', () => {
  it('gives each category section its accent modifier class', () => {
    const { container } = renderSection()
    expect(container.querySelector('.tws-sec--planning')).toBeInTheDocument()
    expect(container.querySelector('.tws-sec--materials')).toBeInTheDocument()
    expect(container.querySelector('.tws-sec--assessment')).toBeInTheDocument()
  })

  it('marks the expander section with the neutral modifier', () => {
    const { container } = renderSection({ allToolsOpen: true })
    expect(container.querySelector('#tws-all-tools')).toHaveClass('tws-sec--more')
  })

  it('renders an aria-hidden sheen span inside every tile', () => {
    const { container } = renderSection({ allToolsOpen: true })
    const cards = container.querySelectorAll('.tws-card')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      const sheen = card.querySelector('.tws-sheen')
      expect(sheen).not.toBeNull()
      expect(sheen).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('still resolves badges from the registry (saved counts win)', () => {
    const { container } = renderSection({
      savedCounts: { scheme_of_work: 3 },
    })
    expect(container.querySelector('.tws-pill.kind-saved')).toHaveTextContent('3 SAVED')
  })
})
