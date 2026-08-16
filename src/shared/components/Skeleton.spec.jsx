import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Skeleton, { SkeletonText, SkeletonCard } from './Skeleton.jsx'

const shimmers = (container) => container.querySelectorAll('.zx-sk')

describe('Skeleton', () => {
  it('renders a shimmer block with sensible defaults (full width, 16px, 10px radius)', () => {
    const { container } = render(<Skeleton />)
    const el = container.firstChild
    expect(el).toHaveClass('zx-sk')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).toHaveStyle({ width: '100%', height: '16px', borderRadius: '10px' })
  })

  it('coerces numeric width/height to px and passes strings through', () => {
    const { container } = render(<Skeleton width={120} height={24} />)
    expect(container.firstChild).toHaveStyle({ width: '120px', height: '24px' })

    const { container: pct } = render(<Skeleton width="60%" />)
    expect(pct.firstChild).toHaveStyle({ width: '60%' })
  })

  it('renders a circle from shape + size (square dims, pill radius)', () => {
    const { container } = render(<Skeleton shape="circle" size={48} />)
    expect(container.firstChild).toHaveStyle({ width: '48px', height: '48px', borderRadius: '9999px' })
  })

  it('appends caller className (so !rounded-* / spacing overrides apply)', () => {
    const { container } = render(<Skeleton className="mt-2 !rounded-full" />)
    expect(container.firstChild).toHaveClass('zx-sk', 'mt-2', '!rounded-full')
  })

  it('SkeletonText renders one shimmer line per `lines`', () => {
    const { container } = render(<SkeletonText lines={4} />)
    expect(shimmers(container)).toHaveLength(4)
  })

  it('SkeletonCard renders an avatar + several text shimmers', () => {
    const { container } = render(<SkeletonCard />)
    // 1 avatar circle + 4 text lines in the card template.
    expect(shimmers(container).length).toBeGreaterThanOrEqual(4)
  })
})
