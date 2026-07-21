/**
 * Behaviour tests for PageThumbnailSheet — the bottom-sheet page picker
 * opened from the glass dock.
 *
 * Covers:
 *   - Nothing renders while closed.
 *   - One cell per page, with the current page marked via aria-current
 *     (not colour alone).
 *   - Selecting a thumbnail calls onSelect with the page number AND
 *     closes the sheet.
 *   - The direct page-number input clamps and selects.
 *   - Thumbnails come from the async getThumbnail(pageNumber) provider
 *     (jsdom has no IntersectionObserver, so cells load eagerly here).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PageThumbnailSheet from './PageThumbnailSheet'

function renderSheet(props = {}) {
  const handlers = {
    onClose: vi.fn(),
    onSelect: vi.fn(),
    getThumbnail: vi.fn().mockResolvedValue('data:image/jpeg;base64,x'),
  }
  render(
    <PageThumbnailSheet
      open
      pageCount={6}
      currentPage={3}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('PageThumbnailSheet', () => {
  it('renders nothing when closed', () => {
    renderSheet({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a cell per page and marks the current page', async () => {
    const { getThumbnail } = renderSheet()
    expect(screen.getByRole('dialog', { name: 'Page thumbnails' })).toBeInTheDocument()
    expect(screen.getByText('Page 3 of 6')).toBeInTheDocument()
    const cells = screen.getAllByRole('button', { name: /^Go to page \d+$/ })
    expect(cells).toHaveLength(6)
    expect(screen.getByRole('button', { name: 'Go to page 3' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Go to page 4' })).not.toHaveAttribute('aria-current')
    // Without IntersectionObserver every cell loads eagerly.
    await waitFor(() => expect(getThumbnail).toHaveBeenCalledWith(3))
  })

  it('selects a page and closes when a thumbnail is tapped', () => {
    const { onSelect, onClose } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 5' }))
    expect(onSelect).toHaveBeenCalledWith(5)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clamps and selects via the direct page-number input', () => {
    const { onSelect, onClose } = renderSheet()
    const input = screen.getByLabelText('Go to page number')
    fireEvent.change(input, { target: { value: '42' } })
    fireEvent.submit(input.closest('form'))
    expect(onSelect).toHaveBeenCalledWith(6) // clamped to the last page
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from the Close button', () => {
    const { onClose, onSelect } = renderSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Close page thumbnails' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })
})
