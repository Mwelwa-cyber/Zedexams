import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ImageZoomOverlay from './ImageZoomOverlay.jsx'

// Regression: the zoom overlay opened to an all-black screen on the past-paper
// viewer. Root cause — it's a `position: fixed` full-viewport layer, but it
// mounts inside the `FullBleed` wrapper whose mobile `-translate-x-1/2` is a
// CSS transform. A transformed ancestor becomes the containing block for
// `fixed`, trapping the overlay inside the (very tall) page-list box: the
// toolbar showed but the image sat far down, off-screen, so all the viewer
// saw was the black background. The fix portals the overlay to <body> so it
// escapes any transformed ancestor. These tests lock that in.

describe('ImageZoomOverlay', () => {
  it('renders the overlay as a direct child of <body>, outside a transformed ancestor', () => {
    const { container } = render(
      // Mirror the real mount point: a transformed ancestor (FullBleed).
      <div style={{ transform: 'translateX(-50%)' }} data-testid="fullbleed">
        <ImageZoomOverlay src="/page-1.png" alt="Page 1 of 12" onClose={() => {}} />
      </div>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Page 1 of 12' })
    // Escaped the transformed wrapper entirely…
    expect(container.querySelector('[data-testid="fullbleed"]').contains(dialog)).toBe(false)
    // …and lives directly under <body>.
    expect(dialog.parentElement).toBe(document.body)
  })

  it('renders the page image at the given src', () => {
    render(<ImageZoomOverlay src="/page-3.png" alt="Page 3 of 12" onClose={() => {}} />)
    const img = screen.getByAltText('Page 3 of 12')
    expect(img).toHaveAttribute('src', '/page-3.png')
  })

  it('calls onClose when the Close button is clicked', () => {
    const onClose = vi.fn()
    render(<ImageZoomOverlay src="/p.png" alt="Page" onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ImageZoomOverlay src="/p.png" alt="Page" onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('locks body scroll while open and restores it on close', () => {
    document.body.style.overflow = ''
    const { unmount } = render(
      <ImageZoomOverlay src="/p.png" alt="Page" onClose={() => {}} />,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})
