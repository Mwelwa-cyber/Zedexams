/**
 * Behaviour tests for GlassPageNavigation — the floating glass dock that
 * drives page-by-page (PDF) past-paper reading.
 *
 * Covers the acceptance criteria that matter most:
 *   - Previous disables on page 1, Next disables on the last page, and
 *     both stay in the document (visible-but-dimmed, no layout jump).
 *   - Prev/Next call through to the owner.
 *   - The thumbnails button only renders when a handler is provided.
 *   - Tapping the page indicator opens the jump input; submitting jumps
 *     to the clamped page number.
 *   - The current position is announced politely to screen readers.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import GlassPageNavigation from './GlassPageNavigation'

function renderDock(props = {}) {
  const handlers = {
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onOpenThumbnails: vi.fn(),
    onJumpToPage: vi.fn(),
  }
  render(
    <GlassPageNavigation
      pageNumber={5}
      pageCount={14}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('GlassPageNavigation — prev/next', () => {
  it('renders both controls enabled mid-document and calls through', () => {
    const { onPrev, onNext } = renderDock()
    const prev = screen.getByRole('button', { name: 'Previous page' })
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(prev).toBeEnabled()
    expect(next).toBeEnabled()
    fireEvent.click(prev)
    fireEvent.click(next)
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('disables Previous on page 1 but keeps it visible', () => {
    renderDock({ pageNumber: 1 })
    const prev = screen.getByRole('button', { name: 'Previous page' })
    expect(prev).toBeDisabled()
    expect(prev).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
  })

  it('disables Next on the final page but keeps it visible', () => {
    renderDock({ pageNumber: 14 })
    const next = screen.getByRole('button', { name: 'Next page' })
    expect(next).toBeDisabled()
    expect(next).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled()
  })
})

describe('GlassPageNavigation — thumbnails + indicator', () => {
  it('shows the thumbnails button only when a handler exists', () => {
    const { onOpenThumbnails } = renderDock()
    const thumbs = screen.getByRole('button', { name: 'Open page thumbnails' })
    fireEvent.click(thumbs)
    expect(onOpenThumbnails).toHaveBeenCalledTimes(1)
  })

  it('hides the thumbnails button without a handler', () => {
    renderDock({ onOpenThumbnails: undefined })
    expect(screen.queryByRole('button', { name: 'Open page thumbnails' })).not.toBeInTheDocument()
  })

  it('shows "5 / 14" and announces the page politely', () => {
    renderDock()
    expect(screen.getByText('5 / 14')).toBeInTheDocument()
    expect(screen.getByText('Page 5 of 14')).toHaveAttribute('aria-live', 'polite')
  })

  it('opens the jump input from the indicator and jumps to a clamped page', () => {
    const { onJumpToPage } = renderDock()
    fireEvent.click(screen.getByRole('button', { name: 'Go to a specific page' }))
    const input = screen.getByLabelText('Go to page')
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.submit(input.closest('form'))
    expect(onJumpToPage).toHaveBeenCalledWith(14) // clamped to the last page
  })
})
