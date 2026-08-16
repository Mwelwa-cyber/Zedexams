/**
 * Behaviour tests for PdfPageStream.jsx — the continuous-scroll PDF viewer.
 *
 * What matters here is the shape of the surface, because that is what made
 * PDF papers read differently from scanned (image) papers in the first
 * place:
 *   - every page of the document is laid out at once, so the reader scrolls
 *     rather than tapping Next,
 *   - the stack flows in the document — no nested vertical scroller
 *     competing with the page for the swipe (the bug PdfJsViewer.spec.jsx
 *     locks in for the old viewer),
 *   - a swipe that starts on the paper still scrolls (`pan-y`) and pinch
 *     zoom survives,
 *   - only a bounded window of pages ever holds a canvas — the whole reason
 *     this is virtualised instead of reusing PdfScrollViewer,
 *   - the glass dock is suppressible for surfaces that own the bottom edge.
 *
 * jsdom reports clientWidth 0 and has no canvas 2D context, so no page is
 * ever rasterised here: every page stays in its skeleton state. That is the
 * point — the layout contract is what is under test, not PDF.js.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  )
})

const PAGE_COUNT = 11

function fakePage() {
  return {
    getViewport: ({ scale = 1 }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
  }
}

vi.mock('../../utils/pdfjsLoader', () => ({
  loadPdfjs: () =>
    Promise.resolve({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: PAGE_COUNT,
          getPage: () => Promise.resolve(fakePage()),
          destroy() {},
        }),
      }),
    }),
}))
vi.mock('../../utils/friendlyErrors', () => ({ friendlyMessage: (_e, fallback) => fallback }))

import PdfPageStream from './PdfPageStream'

/** The page stack is the element the page <article>s live in. */
function stackEl() {
  return document.querySelector('[data-page-number="1"]').parentElement
}

describe('PdfPageStream', () => {
  it('lays out every page of the document as one scrollable stack', async () => {
    render(<PdfPageStream url="https://example.test/paper.pdf" title="Grade 7 CTS 2025" />)

    await waitFor(() => {
      expect(document.querySelectorAll('article[data-page-number]')).toHaveLength(PAGE_COUNT)
    })
    // Per-page captions match the image-paper stack's wording exactly.
    // (Scoped to the articles: the sticky chip and the dock carry the same
    // "Page N of M" string, so an unscoped query matches three elements.)
    const captions = Array.from(
      document.querySelectorAll('article[data-page-number] > p'),
    ).map((p) => p.textContent)
    expect(captions[0]).toBe(`Page 1 of ${PAGE_COUNT}`)
    expect(captions[PAGE_COUNT - 1]).toBe(`Page ${PAGE_COUNT} of ${PAGE_COUNT}`)
  })

  it('flows in the document — no nested vertical scroller, and touch pan survives', async () => {
    render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" />)
    await waitFor(() => expect(document.querySelector('[data-page-number="1"]')).toBeTruthy())

    const stack = stackEl()
    // A nested overflow-y box would steal the swipe from the document, which
    // is exactly the failure the old viewer had to be patched for.
    expect(stack.className).not.toMatch(/overflow-y-auto|overflow-auto/)
    expect(stack.style.overflowY).toBe('')
    // pan-y is essential: pinch-zoom alone blocks single-finger scrolling.
    expect(stack.style.touchAction).toContain('pan-y')
    expect(stack.style.touchAction).toContain('pinch-zoom')
  })

  it('keeps a zoomed page panning inside its own row', async () => {
    render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" />)
    await waitFor(() => expect(document.querySelector('[data-page-number="1"]')).toBeTruthy())

    // Horizontal overflow lives on the per-page strip, not the stack: a
    // horizontally scrollable stack would compute overflow-y to `auto` and
    // reintroduce the nested vertical scrollbar.
    const strip = document.querySelector('[data-page-number="1"] .overflow-x-auto')
    expect(strip).toBeTruthy()
    expect(strip.style.touchAction).toContain('pan-y')
    expect(stackEl().className).not.toMatch(/overflow-x-auto/)
  })

  it('rasterises only a bounded window of pages', async () => {
    render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" />)
    await waitFor(() => expect(document.querySelector('[data-page-number="1"]')).toBeTruthy())

    // Every page has a canvas element (so the ref exists when its turn comes)
    // but an un-drawn page keeps it hidden behind a skeleton — proof the
    // stack is virtualised rather than rendering all 11 pages up front.
    const canvases = document.querySelectorAll('article[data-page-number] canvas')
    expect(canvases).toHaveLength(PAGE_COUNT)
    const visible = Array.from(canvases).filter((c) => !c.className.includes('hidden'))
    expect(visible.length).toBeLessThanOrEqual(3)
  })

  it('shows the sticky page indicator only when the dock is not carrying it', async () => {
    const { unmount } = render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" />)
    await waitFor(() => expect(document.querySelector('[data-page-number="1"]')).toBeTruthy())
    // Dock present: it already shows "N / M", so no second floating chip.
    expect(document.querySelector('.sticky')).toBeNull()
    unmount()

    render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" showDock={false} />)
    await waitFor(() => expect(document.querySelector('[data-page-number="1"]')).toBeTruthy())
    expect(document.querySelector('.sticky')).toBeTruthy()
  })

  it('keeps the glass dock by default and suppresses it when asked', async () => {
    // The dock is the only way to jump pages in a PDF, so it survives the
    // move to continuous scroll — its arrows now scroll instead of paging.
    const { unmount } = render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" />)
    await waitFor(() => expect(screen.getByLabelText('Next page')).toBeInTheDocument())
    unmount()

    render(<PdfPageStream url="https://example.test/paper.pdf" title="Paper" showDock={false} />)
    await waitFor(() => {
      expect(document.querySelectorAll('article[data-page-number]').length).toBe(PAGE_COUNT)
    })
    // Timed practice owns the bottom edge (timer + submit) — no dock there.
    expect(screen.queryByLabelText('Next page')).toBeNull()
  })
})
