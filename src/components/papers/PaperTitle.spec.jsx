/**
 * <PaperTitle/> — the composed name and the source badge.
 *
 * The composition rules themselves are tested under plain node in
 * `src/utils/paperIdentity.test.js`; what needs a DOM is the part that could
 * only fail here — that the badge's MEANING survives without colour, and that
 * the accessible name of a row is the composed title rather than the stored
 * `title` string.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PaperTitle, { PaperSourceBadge } from './PaperTitle'

const ECZ = {
  id: 'p1', grade: '7', subject: 'science', year: 2025,
  source: 'ecz', isOfficial: true, sourceConfidence: 'explicit', paperNumber: 1,
  title: 'In 2025 Science',
}
const MOCK = {
  id: 'p2', grade: '7', subject: 'science', year: 2025,
  source: 'prisca', isOfficial: false, sourceConfidence: 'explicit', paperNumber: 'mock',
  title: 'In 2025 Science',
}

describe('PaperSourceBadge', () => {
  it('says which it is in WORDS, not only in colour', () => {
    render(<PaperSourceBadge label="ECZ" isOfficial />)
    expect(screen.getByText('ECZ')).toBeInTheDocument()
  })

  it('carries the distinction to a screen reader too', () => {
    // The solid-vs-outlined fill is the secondary signal. A reader who sees
    // neither the fill nor the icon still gets the claim.
    const { rerender } = render(<PaperSourceBadge label="ECZ" isOfficial />)
    expect(screen.getByTitle(/official exam paper/i)).toBeInTheDocument()
    rerender(<PaperSourceBadge label="PRISCA mock" isOfficial={false} />)
    expect(screen.getByTitle(/not an ECZ exam/i)).toBeInTheDocument()
  })

  it('uses theme tokens for the official fill — no hardcoded colour', () => {
    // Night mode: a literal hex here is a chip that either vanishes into the
    // background or keeps a light-mode fill under a dark theme.
    const { container } = render(<PaperSourceBadge label="ECZ" isOfficial />)
    const chip = container.firstChild
    expect(chip.className).toMatch(/theme-accent-fill/)
    expect(chip.className).toMatch(/theme-on-accent/)
    expect(chip.className).not.toMatch(/#|bg-(orange|emerald|slate|amber)-\d/)
  })

  it('uses a bordered token chip for a mock — still no hardcoded colour', () => {
    const { container } = render(<PaperSourceBadge label="PRISCA mock" isOfficial={false} />)
    const chip = container.firstChild
    expect(chip.className).toMatch(/theme-border/)
    expect(chip.className).toMatch(/theme-text-muted/)
    expect(chip.className).not.toMatch(/#|bg-(orange|emerald|slate|amber)-\d/)
  })
})

describe('PaperTitle — row variant', () => {
  it('shows the source badge and the paper number, not the stored title', () => {
    render(<PaperTitle paper={ECZ} variant="row" />)
    expect(screen.getByText('ECZ')).toBeInTheDocument()
    expect(screen.getByText('Paper 1')).toBeInTheDocument()
    // The stored title is the free text this whole feature replaced — one live
    // paper's title literally begins with the word "In".
    expect(screen.queryByText('In 2025 Science')).not.toBeInTheDocument()
  })

  it('tells the ECZ paper and the mock apart on line 1', () => {
    const { unmount } = render(<PaperTitle paper={ECZ} variant="row" />)
    expect(screen.getByText('ECZ')).toBeInTheDocument()
    unmount()
    render(<PaperTitle paper={MOCK} variant="row" />)
    expect(screen.getByText('PRISCA mock')).toBeInTheDocument()
  })

  it('says a mock is not an ECZ exam on line 2', () => {
    render(<PaperTitle paper={MOCK} variant="row" />)
    expect(screen.getByText(/not an ECZ exam/i)).toBeInTheDocument()
  })

  it('badges a paper with no source rather than rendering a gap', () => {
    render(<PaperTitle paper={{ id: 'p3', grade: '7', subject: 'english', year: 2024 }} variant="row" />)
    expect(screen.getByText('Unlabelled')).toBeInTheDocument()
  })
})

describe('PaperTitle — full variant', () => {
  it('composes one uncut string from the structured fields', () => {
    render(<PaperTitle paper={ECZ} variant="full" />)
    expect(
      screen.getByText('Grade 7 Integrated Science — Paper 1 · ECZ · 2025'),
    ).toBeInTheDocument()
  })

  it('never ellipsises', () => {
    const { container } = render(<PaperTitle paper={ECZ} variant="full" />)
    expect(container.textContent).not.toMatch(/…|\.\.\./)
  })
})
