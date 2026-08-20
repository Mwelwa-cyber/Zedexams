import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ZoomControl from './ZoomControl'
import { MAX_ZOOM, MIN_ZOOM, FIT_ZOOM } from '../utils/pinchZoomCore'

const noop = () => {}

describe('ZoomControl', () => {
  it('shows the current zoom so an accidental pinch is explicable', () => {
    render(<ZoomControl zoom={2.5} onZoomIn={noop} onZoomOut={noop} onFit={noop} />)
    expect(screen.getByText('250%')).toBeInTheDocument()
  })

  it('offers Fit only once there is something to fit back to', () => {
    const { rerender } = render(
      <ZoomControl zoom={FIT_ZOOM} onZoomIn={noop} onZoomOut={noop} onFit={noop} />,
    )
    expect(screen.queryByLabelText('Fit the page to the screen')).toBeNull()

    // Off fit-to-width there must ALWAYS be a way back — a learner who
    // pinched by accident must never be stuck on a page they cannot navigate.
    rerender(<ZoomControl zoom={1.25} onZoomIn={noop} onZoomOut={noop} onFit={noop} />)
    expect(screen.getByLabelText('Fit the page to the screen')).toBeInTheDocument()
  })

  it('disables the direction that has run out, and keeps the other live', () => {
    const { rerender } = render(
      <ZoomControl zoom={MAX_ZOOM} onZoomIn={noop} onZoomOut={noop} onFit={noop} />,
    )
    expect(screen.getByLabelText('Zoom in')).toBeDisabled()
    expect(screen.getByLabelText('Zoom out')).toBeEnabled()

    rerender(<ZoomControl zoom={MIN_ZOOM} onZoomIn={noop} onZoomOut={noop} onFit={noop} />)
    expect(screen.getByLabelText('Zoom out')).toBeDisabled()
    expect(screen.getByLabelText('Zoom in')).toBeEnabled()
  })

  it('calls back on each control', () => {
    const onZoomIn = vi.fn()
    const onZoomOut = vi.fn()
    const onFit = vi.fn()
    render(<ZoomControl zoom={2} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} />)
    fireEvent.click(screen.getByLabelText('Zoom in'))
    fireEvent.click(screen.getByLabelText('Zoom out'))
    fireEvent.click(screen.getByLabelText('Fit the page to the screen'))
    expect(onZoomIn).toHaveBeenCalledTimes(1)
    expect(onZoomOut).toHaveBeenCalledTimes(1)
    expect(onFit).toHaveBeenCalledTimes(1)
  })

  it('lets the caller place it, because the bottom-right corner is contested', () => {
    // The page dock, the back-to-top FAB and the reader's action bar all live
    // here; a hard-coded offset would sit on top of one of them.
    const { container } = render(
      <ZoomControl zoom={1} onZoomIn={noop} onZoomOut={noop} onFit={noop} bottomPx={86} />,
    )
    expect(container.firstChild.style.bottom).toContain('86px')
    expect(container.firstChild.style.bottom).toContain('safe-area-inset-bottom')
  })
})
