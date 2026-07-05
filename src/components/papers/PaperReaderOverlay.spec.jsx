import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PaperReaderOverlay from './PaperReaderOverlay.jsx'

// The overlay is the immersive reading mode. These tests lock in the three
// behaviours the old native-Fullscreen path got wrong: it renders its content,
// it always offers a working Exit (button + Escape), and it locks page scroll
// while open (so the paper behind can't scroll under the reader).

describe('PaperReaderOverlay', () => {
  beforeEach(() => {
    document.body.style.overflow = ''
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children and the title', () => {
    render(
      <PaperReaderOverlay title="Grade 7 Mathematics · 2023" onClose={() => {}}>
        <div data-testid="paper-body">Paper content</div>
      </PaperReaderOverlay>,
    )
    expect(screen.getByTestId('paper-body')).toBeInTheDocument()
    expect(screen.getByText('Grade 7 Mathematics · 2023')).toBeInTheDocument()
  })

  it('locks body scroll while open and restores it on close', () => {
    const { unmount } = render(
      <PaperReaderOverlay title="Paper" onClose={() => {}}>
        <div>body</div>
      </PaperReaderOverlay>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('calls onClose when the Exit button is clicked', () => {
    const onClose = vi.fn()
    render(
      <PaperReaderOverlay title="Paper" onClose={onClose}>
        <div>body</div>
      </PaperReaderOverlay>,
    )
    fireEvent.click(screen.getByRole('button', { name: /exit reading mode/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn()
    render(
      <PaperReaderOverlay title="Paper" onClose={onClose}>
        <div>body</div>
      </PaperReaderOverlay>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a Download button only when onDownload is provided, and calls it', () => {
    const onDownload = vi.fn()
    const { rerender } = render(
      <PaperReaderOverlay title="Paper" onClose={() => {}}>
        <div>body</div>
      </PaperReaderOverlay>,
    )
    expect(screen.queryByRole('button', { name: /download paper/i })).toBeNull()

    rerender(
      <PaperReaderOverlay title="Paper" onClose={() => {}} onDownload={onDownload}>
        <div>body</div>
      </PaperReaderOverlay>,
    )
    fireEvent.click(screen.getByRole('button', { name: /download paper/i }))
    expect(onDownload).toHaveBeenCalledTimes(1)
  })

  it('disables the Download button and shows a preparing label while downloading', () => {
    render(
      <PaperReaderOverlay title="Paper" onClose={() => {}} onDownload={() => {}} downloading>
        <div>body</div>
      </PaperReaderOverlay>,
    )
    const btn = screen.getByRole('button', { name: /download paper/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent(/preparing/i)
  })
})
