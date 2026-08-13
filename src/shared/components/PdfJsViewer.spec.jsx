/**
 * Mobile scroll / touch regression tests for PdfJsViewer.jsx.
 *
 * The past-paper viewer opens PDFs through this component in `dock` mode.
 * A prior bug set the canvas surface's `touch-action` to `pinch-zoom`,
 * which blocks single-finger vertical scrolling — a swipe that started on
 * the paper froze the whole page — and wrapped the canvas in an
 * `overflow-auto` / `max-height: 85vh` box that competed with the document
 * for vertical scroll. These tests lock in the fix:
 *   - the surface always allows `pan-y` (never pinch-zoom-only, never none),
 *   - the embedded (`dock`) viewer flows in the document with no fixed
 *     max-height nested vertical scrollbar,
 *   - the classic bounded preview keeps its box but still allows touch pan,
 *   - fullscreen (`fill`) keeps its own contained scroll surface.
 *
 * pdfjs is mocked to never resolve, so the component stays in its loading
 * state and only the (always-rendered) canvas + surface shell is exercised.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'

// jsdom ships neither observer; PdfJsViewer wires a ResizeObserver on mount.
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
})

vi.mock('../../utils/pdfjsLoader', () => ({
  // Never resolves: keep the viewer in its loading state for the whole test.
  loadPdfjs: () => new Promise(() => {}),
}))
vi.mock('../../utils/friendlyErrors', () => ({ friendlyMessage: (_e, fallback) => fallback }))

import PdfJsViewer from './PdfJsViewer'

/** The scroll surface is the canvas's parent div. */
function surfaceFor(title) {
  return screen.getByLabelText(title).parentElement
}

describe('PdfJsViewer — mobile scroll/touch behaviour', () => {
  it('never blocks single-finger vertical scroll on the canvas surface', () => {
    render(<PdfJsViewer url="https://example.test/p.pdf" title="Paper" dock />)
    const surface = surfaceFor('Paper')
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom')
    expect(surface.style.touchAction).not.toBe('none')
    expect(surface.style.touchAction).not.toBe('pinch-zoom')
  })

  it('embedded (dock) viewer flows in the document — no fixed max-height nested scroll', () => {
    render(<PdfJsViewer url="https://example.test/p.pdf" title="Paper" dock />)
    const surface = surfaceFor('Paper')
    expect(surface.style.maxHeight).toBe('')
    expect(surface.style.minHeight).toBe('')
    expect(surface.style.overflowY).toBe('visible')
  })

  it('classic preview keeps a bounded box but still permits vertical touch pan', () => {
    render(<PdfJsViewer url="https://example.test/p.pdf" title="Paper" />)
    const surface = surfaceFor('Paper')
    expect(surface.style.maxHeight).toBe('85vh')
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom')
  })

  it('fullscreen (fill) keeps its own contained scroll surface with pan-y', () => {
    render(<PdfJsViewer url="https://example.test/p.pdf" title="Paper" fill dock />)
    const surface = surfaceFor('Paper')
    // Fullscreen manages its own scroll area (flex-1 min-h-0 overflow-auto),
    // so it does NOT switch to document-flow overflow-y: visible.
    expect(surface.style.overflowY).not.toBe('visible')
    expect(surface.style.touchAction).toBe('pan-y pinch-zoom')
    expect(surface.style.overscrollBehaviorY).toBe('contain')
  })
})
