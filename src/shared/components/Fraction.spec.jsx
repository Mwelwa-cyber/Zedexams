/**
 * The canonical fraction renderer.
 *
 * There is one thing to prove here and it is not layout: a stacked fraction is
 * two numbers in a column, and a screen reader handed that markup says "three
 * four", which is not a quantity. The digits are hidden, the WORDS are the
 * accessible name, and both come from the same two numbers — so the spoken and
 * printed forms cannot drift, because there is nowhere for a second string to
 * live.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import Frac, { MixedNumber, fractionLabel } from './Fraction'

describe('<Frac>', () => {
  it('is a maths expression, named in words', () => {
    render(<Frac n={3} d={4} />)
    const frac = screen.getByRole('math', { name: 'three quarters' })
    expect(frac).toBeInTheDocument()
    expect(frac).toHaveTextContent('34')
  })

  it('hides the digits from assistive technology, so nothing says "three four"', () => {
    const { container } = render(<Frac n={3} d={4} />)
    expect(container.querySelector('.zx-frac-stack')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('.zx-frac-n')).toHaveTextContent('3')
    expect(container.querySelector('.zx-frac-d')).toHaveTextContent('4')
  })

  it('names an improper fraction as the amount it is, not as a mixed one', () => {
    render(<Frac n={11} d={4} />)
    expect(screen.getByRole('math', { name: 'eleven quarters' })).toBeInTheDocument()
  })

  it('a mixed number is the same component with a whole in front', () => {
    const { container } = render(<Frac n={3} d={4} whole={2} />)
    expect(screen.getByRole('math', { name: 'two and three quarters' })).toBeInTheDocument()
    expect(container.querySelector('.zx-frac-w')).toHaveTextContent('2')
    // …and rendering it through the named twin gives byte-identical markup,
    // because it IS the same component. Two code paths is how the two come to
    // look different.
    const twin = render(<MixedNumber n={3} d={4} whole={2} />)
    expect(twin.container.querySelector('.zx-frac').outerHTML)
      .toBe(container.querySelector('.zx-frac').outerHTML)
  })

  it('handles the unit names English is irregular about', () => {
    for (const [n, d, words] of [
      [1, 2, 'one half'], [2, 2, 'two halves'], [1, 3, 'one third'], [3, 4, 'three quarters'],
      [1, 8, 'one eighth'], [5, 12, 'five twelfths'], [9, 20, 'nine twentieths'], [7, 13, 'seven thirteenths'],
    ]) {
      const { unmount } = render(<Frac n={n} d={d} />)
      expect(screen.getByRole('math', { name: words })).toBeInTheDocument()
      unmount()
    }
  })

  it('a whole written over one reads as the number', () => {
    render(<Frac n={180} d={1} />)
    expect(screen.getByRole('math', { name: '180' })).toBeInTheDocument()
  })

  it('the size is a class, so it scales with the text rather than being redrawn', () => {
    const { container: inline } = render(<Frac n={1} d={2} />)
    expect(inline.querySelector('.zx-frac')).toHaveClass('zx-frac-inline')
    const { container: big } = render(<Frac n={1} d={2} size="lg" />)
    expect(big.querySelector('.zx-frac')).toHaveClass('zx-frac-lg')
    const { container: block } = render(<Frac n={1} d={2} size="block" />)
    expect(block.querySelector('.zx-frac').className.trim()).toBe('zx-frac')
  })

  it('the spoken form is available as a string, for a caller that needs one', () => {
    expect(fractionLabel(3, 4)).toBe('three quarters')
    expect(fractionLabel(3, 4, 2)).toBe('two and three quarters')
    // The same function the renderer uses, which is what keeps a toast and the
    // fraction it is about saying the same thing.
    render(<Frac n={3} d={4} whole={2} />)
    expect(screen.getByRole('math', { name: fractionLabel(3, 4, 2) })).toBeInTheDocument()
  })
})
