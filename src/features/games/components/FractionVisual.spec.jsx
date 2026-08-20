/**
 * The fraction picture, as rendered.
 *
 * `test:fraction-visual` proves the GEOMETRY is exact. This proves the drawing
 * uses it — that four wedges reach the DOM as four wedges, that a learner can
 * tap them with a finger or a keyboard, and that a picture that disagrees with
 * its fraction draws nothing rather than drawing a lie.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import FractionVisual from './FractionVisual'

const svg = (container) => container.querySelector('svg')

describe('<FractionVisual>', () => {
  it('draws one region per part, and shades exactly the numerator', () => {
    const { container } = render(
      <FractionVisual visual={{ shape: 'circle', object: 'orange', parts: 4, numerator: 3, shaded: 3 }} />,
    )
    expect(container.querySelectorAll('path[d^="M"]').length).toBeGreaterThanOrEqual(4)
    // The picture names itself in words, so a screen reader gets the fraction
    // rather than "image".
    expect(screen.getByRole('img', { name: /orange in 4 equal pieces, 3 shaded — three quarters/ })).toBeInTheDocument()
  })

  it('a bar has one rectangle per part', () => {
    const { container } = render(
      <FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 5, numerator: 2, shaded: 2 }} />,
    )
    // One background rect plus five segments.
    expect(container.querySelectorAll('rect').length).toBe(6)
    expect(screen.getByRole('img', { name: /bun in 5 equal pieces, 2 shaded — two fifths/ })).toBeInTheDocument()
  })

  it('a group is a set of things, and says so rather than calling itself a cut-up whole', () => {
    render(<FractionVisual visual={{ shape: 'group', object: 'sweet', parts: 8, numerator: 2, shaded: 2 }} />)
    expect(screen.getByRole('img', { name: /sweet in 8 equal pieces, 2 shaded — two eighths/ })).toBeInTheDocument()
  })

  it('an unequal picture says it is unequal, which is the whole of that question', () => {
    render(
      <FractionVisual visual={{
        shape: 'circle', object: 'orange', parts: 2, numerator: 1, shaded: 1,
        shares: [0.33, 0.67], expectEqual: false,
      }} />,
    )
    expect(screen.getByRole('img', { name: /cut into 2 pieces that are not the same size/ })).toBeInTheDocument()
  })

  it('a picture that disagrees with its fraction draws NOTHING, not a lie', () => {
    // A five-wedge circle labelled "three quarters" renders perfectly and
    // teaches a child that a quarter is a fifth. It should never reach a
    // learner — `test:fraction-content` fails the build on one — but a pack
    // edited live in Firestore can carry one, and a missing diagram is
    // recoverable where a wrong one is not.
    const { container } = render(
      <FractionVisual visual={{ shape: 'circle', parts: 5, denominator: 4, numerator: 3 }} />,
    )
    expect(svg(container)).toBeNull()
  })

  it('regions are real buttons when the learner has to tap them', () => {
    const onToggle = vi.fn()
    render(
      <FractionVisual
        visual={{ shape: 'bar', object: 'bun', parts: 4 }}
        interactive
        chosen={[]}
        onToggle={onToggle}
      />,
    )
    const pieces = screen.getAllByRole('button')
    expect(pieces).toHaveLength(4)
    expect(pieces[2]).toHaveAccessibleName('Piece 3 of 4')
    fireEvent.click(pieces[2])
    expect(onToggle).toHaveBeenCalledWith(2)
  })

  it('a keyboard reaches every region', () => {
    const onToggle = vi.fn()
    render(
      <FractionVisual visual={{ shape: 'circle', object: 'orange', parts: 3 }} interactive chosen={[]} onToggle={onToggle} />,
    )
    const [first] = screen.getAllByRole('button')
    expect(first).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(first, { key: 'Enter' })
    fireEvent.keyDown(first, { key: ' ' })
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it('a shaded region reports itself as pressed, and the count is announced', () => {
    render(
      <FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 4 }} interactive chosen={[0, 1]} onToggle={() => {}} />,
    )
    const pieces = screen.getAllByRole('button')
    expect(pieces[0]).toHaveAttribute('aria-pressed', 'true')
    expect(pieces[3]).toHaveAttribute('aria-pressed', 'false')
    // Shading is a visual state a screen-reader user would otherwise have to
    // walk every region to discover.
    expect(screen.getByText('2 of 4 shaded')).toBeInTheDocument()
  })

  it('an interactive picture handed another question\'s answer shades nothing', () => {
    // The bug this replaced: a choice id arriving at a shading picture on the
    // first frame of a new question. It must not crash and must not read a
    // string as a set of regions — and a value that is not a list is not a
    // learner selection at all, so no count is announced for it.
    const { container } = render(
      <FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 4 }} interactive chosen={'quarter'} onToggle={() => {}} />,
    )
    expect(screen.getAllByRole('button')).toHaveLength(4)
    for (const piece of screen.getAllByRole('button')) {
      expect(piece).toHaveAttribute('aria-pressed', 'false')
    }
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('the learner\'s own shading stays on screen once the question is marked', () => {
    // `interactive` decides whether the regions are BUTTONS, not what is
    // shaded. It used to decide both, so the moment a shading question was
    // marked the picture reverted to the pack's own (empty) shading and the
    // pieces the learner had just tapped vanished under the words telling them
    // they were right.
    render(
      <FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 4 }} chosen={[0, 1]} />,
    )
    expect(screen.getByRole('img', { name: /bun in 4 equal pieces, 2 shaded — two quarters/ })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('a picture nobody taps has no buttons at all', () => {
    render(<FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 4, numerator: 2, shaded: 2 }} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('a caption sits with the picture, as a figure', () => {
    const { container } = render(
      <FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 2, numerator: 1, shaded: 1 }} caption="Half a bun." />,
    )
    expect(container.querySelector('figure')).toBeInTheDocument()
    expect(container.querySelector('figcaption')).toHaveTextContent('Half a bun.')
  })

  it('scales from a viewBox, so the same drawing is a thumbnail or a full diagram', () => {
    const { container } = render(
      <FractionVisual visual={{ shape: 'bar', object: 'bun', parts: 4, numerator: 1, shaded: 1 }} size="sm" />,
    )
    expect(svg(container)).toHaveAttribute('viewBox')
    expect(container.querySelector('.lhx-fv')).toHaveClass('is-sm')
  })
})
