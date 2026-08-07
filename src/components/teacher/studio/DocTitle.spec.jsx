import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DocTitle from './DocTitle.jsx'

// The reported bug is a RENDERING one — the composition is covered under plain
// node in scripts/test-doc-title.mjs. What this suite pins is that the right
// composition reaches the DOM at each width, and that the phone's tap target
// exists (it is the only route to the facts the two-line form compresses).

const PAPER = {
  grade: '4',
  subject: 'Integrated Science',
  assessmentType: 'end_of_term',
  term: '1',
  year: '2026',
}

function setViewport(width) {
  window.matchMedia = (query) => {
    const matches = query.includes('max-width: 767px') ? width <= 767 : width >= 900
    return {
      matches,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }
  }
}

const originalMatchMedia = window.matchMedia
beforeEach(() => { setViewport(1200) })
afterEach(() => { window.matchMedia = originalMatchMedia })

describe('DocTitle — the paper is identifiable at every width', () => {
  it('prints the paper in full on a wide screen', () => {
    setViewport(1200)
    render(<DocTitle paper={PAPER} status="Draft" />)
    expect(screen.getByText('Grade 4 Integrated Science — End of Term 1 Test · 2026')).toBeInTheDocument()
  })

  it('compresses the type but keeps the term and year at medium width', () => {
    setViewport(800)
    render(<DocTitle paper={PAPER} status="Draft" />)
    expect(screen.getByText('Grade 4 Integrated Science — EOT 1 · 2026')).toBeInTheDocument()
  })

  it('stacks onto two lines at 360px, with nothing cut off', () => {
    setViewport(360)
    render(<DocTitle paper={PAPER} status="Draft" onOpenDetails={vi.fn()} />)
    expect(screen.getByText('Integrated Science')).toBeInTheDocument()
    // Every fact the wide form carried is still on screen — the level, the
    // type WITH its term, the year, and the save status.
    expect(screen.getByText('Grade 4 · End of Term 1 · 2026 · Draft')).toBeInTheDocument()
  })

  it('tapping the title on a phone opens the paper-details sheet', () => {
    setViewport(360)
    const onOpenDetails = vi.fn()
    render(<DocTitle paper={PAPER} status="Draft" onOpenDetails={onOpenDetails} />)
    fireEvent.click(screen.getByRole('button', { name: /paper details/i }))
    expect(onOpenDetails).toHaveBeenCalled()
  })

  it('is not a button on a wide screen — there is nothing the sheet would add', () => {
    setViewport(1200)
    render(<DocTitle paper={PAPER} status="Draft" onOpenDetails={vi.fn()} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('carries the full title as the hover/screen-reader text at every width', () => {
    setViewport(360)
    const { container } = render(<DocTitle paper={PAPER} status="Draft" onOpenDetails={vi.fn()} />)
    expect(container.querySelector('.sv-doc-title'))
      .toHaveAttribute('title', 'Grade 4 Integrated Science — End of Term 1 Test · 2026')
  })
})
