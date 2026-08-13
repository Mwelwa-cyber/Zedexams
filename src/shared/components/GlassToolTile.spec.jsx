/**
 * GlassToolTile — the compact tool visual (Recently Used, Quick Create).
 *
 * The contract under test:
 *  - a studio WITH artwork renders BARE: the shared `glass-artwork` mount
 *    and no glass tile, because a rounded box behind a transparent cut-out
 *    is a second, harder-edged tile inside the glass one. It carries no
 *    sheen either — a bare icon has no surface for a sweep to cross;
 *  - a studio WITHOUT artwork keeps the glass tile and its tinted identity
 *    chip: a glyph needs a ground to read against, a rendered illustration
 *    does not;
 *  - either way it composes the studio's category accent class, so a
 *    Planning tool is lit peach on every surface;
 *  - the whole thing is aria-hidden decoration (the wrapping Link carries
 *    the accessible name);
 *  - the NEW badge carries the shared shimmer class — the one allowed loop;
 *  - sheen renders only when asked for AND only where there is a surface
 *    (the Quick Create sheet turns it off because it remounts on open).
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LayoutGrid } from 'lucide-react'
import GlassToolTile from './GlassToolTile'

const imageStudio = {
  id: 'lesson-plans',
  category: 'planning',
  image: 'lesson-plans.webp',
  icon: LayoutGrid,
}

const iconStudio = {
  id: 'reports',
  category: 'assessment',
  image: null,
  icon: LayoutGrid,
  tint: 'blue',
}

describe('GlassToolTile', () => {
  it('floats artwork bare — no glass tile, no box, no sheen behind the icon', () => {
    const { container } = render(
      <GlassToolTile studio={imageStudio} sizeClass="tdv2m-recent-tile" />,
    )
    const tile = container.firstChild
    expect(tile).toHaveClass(
      'glass-artwork',
      'is-bare',
      'glass-accent--planning',
      'tdv2m-recent-tile',
    )
    // The whole point: no tile surface behind the cut-out.
    expect(tile).not.toHaveClass('glass-tile')
    expect(tile.querySelector('.glass-sheen')).toBeNull()
    expect(tile).toHaveAttribute('aria-hidden', 'true')
    expect(tile.querySelector('img')).toHaveAttribute('src', 'lesson-plans.webp')
  })

  it('clips the one studio whose artwork still has its box baked in', () => {
    const { container } = render(
      <GlassToolTile studio={{ ...imageStudio, boxedArtwork: true }} sizeClass="x" />,
    )
    expect(container.querySelector('img')).toHaveClass('is-boxed')
  })

  it('keeps the glass tile and tinted chip for a studio with no artwork', () => {
    const { container } = render(
      <GlassToolTile studio={iconStudio} sizeClass="tdv2m-recent-tile" />,
    )
    const tile = container.firstChild
    expect(tile).toHaveClass('glass-tile', 'glass-accent--assessment')
    expect(tile).not.toHaveClass('glass-artwork')
    expect(tile.querySelector('.tdv2m-glass-chip')).toHaveClass('tint-blue')
    expect(tile.querySelector('img')).toBeNull()
  })

  it('renders the NEW badge with the shared shimmer class', () => {
    const { container } = render(
      <GlassToolTile studio={imageStudio} badge={{ type: 'new', label: 'New' }} sizeClass="x" />,
    )
    const badge = container.querySelector('.tdv2m-tool-new')
    expect(badge).toHaveClass('glass-badge-shimmer')
    expect(badge).toHaveTextContent('New')
  })

  it('omits the sheen when disabled on a tile that has a surface', () => {
    const { container } = render(
      <GlassToolTile studio={iconStudio} sizeClass="x" sheen={false} />,
    )
    expect(container.querySelector('.glass-sheen')).toBeNull()
  })

  it('sheens an icon-only tile by default — it is the one with a surface', () => {
    const { container } = render(<GlassToolTile studio={iconStudio} sizeClass="x" />)
    expect(container.querySelector('.glass-sheen')).not.toBeNull()
  })

  it('falls back to the neutral accent for a studio with no category', () => {
    const { container } = render(
      <GlassToolTile studio={{ ...imageStudio, category: undefined }} sizeClass="x" />,
    )
    expect(container.firstChild).toHaveClass('glass-accent--more')
  })
})
