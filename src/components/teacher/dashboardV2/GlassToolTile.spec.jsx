/**
 * GlassToolTile — the one mobile tool-tile visual.
 *
 * The contract under test:
 *  - the tile composes glass-tile + the studio's category accent class, so
 *    a Planning tool presses/rings peach on every surface;
 *  - the whole tile is aria-hidden decoration (the wrapping Link carries
 *    the accessible name);
 *  - artwork studios render their image ON the glass; icon-only studios
 *    keep their tinted identity chip;
 *  - the NEW badge carries the shared shimmer class — the one allowed loop;
 *  - sheen renders only when asked for (the Quick Create sheet turns it
 *    off because it remounts on every open).
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
  it('renders an aria-hidden glass tile with the category accent and size class', () => {
    const { container } = render(
      <GlassToolTile studio={imageStudio} sizeClass="tdv2m-tool-tile" />,
    )
    const tile = container.firstChild
    expect(tile).toHaveClass('glass-tile', 'glass-accent--planning', 'tdv2m-tool-tile')
    expect(tile).toHaveAttribute('aria-hidden', 'true')
    expect(tile.querySelector('.glass-sheen')).not.toBeNull()
    expect(tile.querySelector('img')).toHaveAttribute('src', 'lesson-plans.webp')
  })

  it('gives icon-only studios their tinted identity chip', () => {
    const { container } = render(
      <GlassToolTile studio={iconStudio} sizeClass="tdv2m-tool-tile" />,
    )
    const tile = container.firstChild
    expect(tile).toHaveClass('glass-accent--assessment')
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

  it('omits the sheen when disabled', () => {
    const { container } = render(
      <GlassToolTile studio={imageStudio} sizeClass="x" sheen={false} />,
    )
    expect(container.querySelector('.glass-sheen')).toBeNull()
  })

  it('falls back to the neutral accent for a studio with no category', () => {
    const { container } = render(
      <GlassToolTile studio={{ ...imageStudio, category: undefined }} sizeClass="x" />,
    )
    expect(container.firstChild).toHaveClass('glass-accent--more')
  })
})
