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

// Every teacher navigation surface now asks studioAvailability which studios
// are on offer, and that reads settings/global. Stubbed to the LAUNCH state
// (no flags set → Worksheet Studio withdrawn, Rubric Studio retired).
vi.mock('../../../contexts/PlatformSettingsContext', () => ({
  usePlatformSettings: () => ({ settings: { featureFlags: {} }, loaded: true, live: true }),
}))

const renderSection = (props = {}) =>
  render(
    <MemoryRouter>
      <TeacherWorkspaceSection {...props} />
    </MemoryRouter>,
  )

describe('TeacherWorkspaceSection glass tiles', () => {
  it('gives each category section its glass-panel accent class', () => {
    const { container } = renderSection()
    expect(container.querySelector('.tws-sec.glass-panel--planning')).toBeInTheDocument()
    expect(container.querySelector('.tws-sec.glass-panel--materials')).toBeInTheDocument()
    expect(container.querySelector('.tws-sec.glass-panel--assessment')).toBeInTheDocument()
  })

  it('marks the expander section as the neutral glass panel', () => {
    const { container } = renderSection({ allToolsOpen: true })
    expect(container.querySelector('#tws-all-tools')).toHaveClass('glass-panel')
  })

  it('renders every card as a glass tile with an aria-hidden sheen span', () => {
    const { container } = renderSection({ allToolsOpen: true })
    const cards = container.querySelectorAll('.tws-card')
    expect(cards.length).toBeGreaterThan(0)
    for (const card of cards) {
      expect(card).toHaveClass('glass-tile')
      const sheen = card.querySelector('.glass-sheen')
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
