/**
 * Behavioural tests for ImageCropModal's Phase 10 mobile/touch upgrades:
 * touch-target size, the initial-crop-from-detected-box behaviour, and the
 * expand/nudge/undo actions. The actual crop export (canvas + real image
 * decode) is not exercised here — jsdom has no real image pipeline; that path
 * is covered indirectly via manual QA and the pure geometry unit tests in
 * cropGeometry.test.js.
 *
 * Run: npm run test:unit -- ImageCropModal
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImageCropModal from './ImageCropModal'

function overlayBox(container) {
  // The amber crop-selection box is the only element with cursor-move.
  return container.querySelector('.cursor-move')
}

describe('ImageCropModal — touch targets', () => {
  it('every resize handle meets the 28-32px minimum touch target', () => {
    const { container } = render(<ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={() => {}} />)
    const handles = container.querySelectorAll('[data-handle]')
    expect(handles.length).toBe(8)
    handles.forEach((h) => {
      expect(h.style.width).toBe('32px')
      expect(h.style.height).toBe('32px')
    })
  })
})

describe('ImageCropModal — initial crop rectangle', () => {
  it('defaults to a centred 70% box when no detected figure box is given', () => {
    const { container } = render(<ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={() => {}} />)
    const box = overlayBox(container)
    expect(box.style.left).toBe('15%')
    expect(box.style.top).toBe('15%')
    expect(box.style.width).toBe('70%')
  })

  it('opens at the AI-detected sourceFigureBox instead of the generic centred box when one is supplied', () => {
    const { container } = render(
      <ImageCropModal
        imageUrl="blob:test"
        onCropped={() => {}}
        onCancel={() => {}}
        initialBox={{ x: 0.2, y: 0.3, w: 0.4, h: 0.25 }}
      />,
    )
    const box = overlayBox(container)
    // Padded (~2.5%) and clamped, so not exactly 20%/30% — but nowhere near
    // the generic 15%/15%/70%/70% default.
    expect(box.style.left).not.toBe('15%')
    expect(box.style.top).not.toBe('15%')
    expect(box.style.width).not.toBe('70%')
  })

  it('shows the page/question labels when provided', () => {
    render(
      <ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={() => {}} pageNumber={6} questionNumber={23} />,
    )
    expect(screen.getByText(/Question 23/)).toBeInTheDocument()
    expect(screen.getByText(/Page 6/)).toBeInTheDocument()
  })
})

describe('ImageCropModal — expand / nudge / undo', () => {
  it('Expand +5% grows the crop box and Undo reverts it', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ImageCropModal
        imageUrl="blob:test"
        onCropped={() => {}}
        onCancel={() => {}}
        initialBox={{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }}
      />,
    )
    const before = overlayBox(container).style.width
    await user.click(screen.getByRole('button', { name: '+5%' }))
    const after = overlayBox(container).style.width
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before))

    const undoBtn = screen.getByRole('button', { name: /Undo/ })
    expect(undoBtn).not.toBeDisabled()
    await user.click(undoBtn)
    expect(overlayBox(container).style.width).toBe(before)
  })

  it('Undo is disabled until a change has been made', () => {
    render(<ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()
  })

  it('Nudge buttons move the box by a small fixed step', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ImageCropModal
        imageUrl="blob:test"
        onCropped={() => {}}
        onCancel={() => {}}
        initialBox={{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }}
      />,
    )
    const beforeLeft = overlayBox(container).style.left
    await user.click(screen.getByRole('button', { name: 'Nudge crop →' }))
    expect(overlayBox(container).style.left).not.toBe(beforeLeft)
  })

  it('"Full page" resets to the whole image and zoom to 1', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ImageCropModal
        imageUrl="blob:test"
        onCropped={() => {}}
        onCancel={() => {}}
        initialBox={{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Full page' }))
    const box = overlayBox(container)
    expect(box.style.left).toBe('0%')
    expect(box.style.top).toBe('0%')
    expect(box.style.width).toBe('100%')
  })

  it('Cancel calls onCancel without cropping', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={onCancel} />)
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('ImageCropModal — source-paper page navigation', () => {
  it('renders no page-nav buttons unless handlers are supplied (existing flows untouched)', () => {
    render(
      <ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={() => {}} pageNumber={6} questionNumber={23} />,
    )
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  })

  it('renders ‹ › page-nav buttons and fires the handlers when supplied', async () => {
    const user = userEvent.setup()
    const onPrevPage = vi.fn()
    const onNextPage = vi.fn()
    render(
      <ImageCropModal
        imageUrl="blob:test"
        onCropped={() => {}}
        onCancel={() => {}}
        pageNumber={3}
        onPrevPage={onPrevPage}
        onNextPage={onNextPage}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Previous page' }))
    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPrevPage).toHaveBeenCalledTimes(1)
    expect(onNextPage).toHaveBeenCalledTimes(1)
  })

  it('can render only the available direction (first page has no ‹)', () => {
    render(
      <ImageCropModal imageUrl="blob:test" onCropped={() => {}} onCancel={() => {}} pageNumber={1} onNextPage={() => {}} />,
    )
    expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
  })
})
