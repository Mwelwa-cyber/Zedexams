/**
 * The paginated A4 preview (§1).
 *
 * What is worth testing here is not that the sheets look right — that is the
 * visual gate's job — but the two claims the component makes: that it draws the
 * pages the MEASUREMENT found rather than boundaries of its own, and that zoom
 * cannot reach any of it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PaperPagesPreview from './PaperPagesPreview.jsx'
import { PAGINATION_STATES } from '../../../utils/paperPaginationCore.js'
import { resolvePaperLayout } from '../../../config/paperLayoutTokens.js'

// jsdom has no ResizeObserver, and the component uses it to resolve "fit width".
// Stubbed rather than omitted: without it the layout effect throws and every
// test here would pass for the wrong reason.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

const question = (n) => ({
  kind: 'question',
  number: n,
  text: `Question ${n} text`,
  type: 'mcq',
  options: ['a', 'b', 'c', 'd'],
  optionsPlain: ['a', 'b', 'c', 'd'],
  optionsHtml: [],
  optionsNodes: [],
  optionMedia: [],
  marks: 1,
  subParts: [],
  statements: [],
  images: [],
  diagramLabels: [],
  matchingLeft: [],
  matchingRight: [],
  matchingAnswer: [],
  sequenceItems: [],
  sequenceAnswer: [],
  blankLabels: [],
  wordBank: [],
})

const blocks = [question(1), question(2), question(3), question(4)]

const measured = (pages) => ({
  status: PAGINATION_STATES.READY,
  pageCount: pages.length,
  pages,
  issues: [],
})

const sheets = (container) => container.querySelectorAll('.pp-sheet')

describe('PaperPagesPreview — real sheets, measured boundaries', () => {
  it('draws one A4 sheet per measured page', () => {
    const { container } = render(
      <PaperPagesPreview
        blocks={blocks}
        pagination={measured([
          { pageNumber: 1, blockIndexes: [0, 1] },
          { pageNumber: 2, blockIndexes: [2, 3] },
        ])}
      />,
    )
    expect(sheets(container)).toHaveLength(2)
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it('puts each block on the page the measurement put it on', () => {
    const { container } = render(
      <PaperPagesPreview
        blocks={blocks}
        pagination={measured([
          { pageNumber: 1, blockIndexes: [0] },
          { pageNumber: 2, blockIndexes: [1, 2, 3] },
        ])}
      />,
    )
    const [first, second] = sheets(container)
    expect(first.textContent).toContain('Question 1 text')
    expect(first.textContent).not.toContain('Question 2 text')
    expect(second.textContent).toContain('Question 2 text')
    expect(second.textContent).toContain('Question 4 text')
  })

  it('sizes the sheet in millimetres, from the document’s own layout', () => {
    const { container } = render(
      <PaperPagesPreview
        blocks={blocks}
        layout={resolvePaperLayout({ pageSize: 'a5', orientation: 'landscape' })}
        pagination={measured([{ pageNumber: 1, blockIndexes: [0, 1, 2, 3] }])}
      />,
    )
    const sheet = sheets(container)[0]
    // A5 landscape: 210mm across, 148mm down. Millimetres rather than pixels
    // converted from them, so the on-screen sheet cannot be a slightly different
    // shape from the printed one.
    expect(sheet.style.width).toBe('210mm')
    expect(sheet.style.height).toBe('148mm')
    expect(screen.getByText(/A5 · Landscape/)).toBeInTheDocument()
  })

  it('keeps a measured blank page, because the teacher should see it', () => {
    const { container } = render(
      <PaperPagesPreview
        blocks={blocks}
        pagination={measured([
          { pageNumber: 1, blockIndexes: [0, 1, 2, 3] },
          { pageNumber: 2, blockIndexes: [] },
        ])}
      />,
    )
    expect(sheets(container)).toHaveLength(2)
    expect(sheets(container)[1].textContent.trim()).toBe('')
  })
})

describe('PaperPagesPreview — when nothing has been measured', () => {
  it('shows one continuous sheet and says the count is not final', () => {
    const { container } = render(
      <PaperPagesPreview blocks={blocks} pagination={{ status: PAGINATION_STATES.MEASURING, pages: [] }} />,
    )
    expect(sheets(container)).toHaveLength(1)
    // Both the toolbar and the sheet's own label say so — the toolbar because
    // that is where a page count lives, the label because a sheet with no
    // position must not sit there unlabelled looking like page 1.
    expect(screen.getAllByText(/counting pages/i).length).toBeGreaterThan(0)
    // A continuous sheet must not LOOK like a measured page: it has no fixed
    // height, because nobody has verified where it ends.
    expect(sheets(container)[0].style.height).toBe('')
    expect(sheets(container)[0].style.minHeight).toBe('297mm')
  })

  it('never claims a page position it has not measured', () => {
    render(<PaperPagesPreview blocks={blocks} pagination={{ status: PAGINATION_STATES.STALE, pages: [] }} />)
    expect(screen.queryByText(/^Page 1 of/)).not.toBeInTheDocument()
  })

  it('draws every block, so a preview is never missing content the PDF has', () => {
    const { container } = render(<PaperPagesPreview blocks={blocks} pagination={null} />)
    for (const n of [1, 2, 3, 4]) {
      expect(container.textContent).toContain(`Question ${n} text`)
    }
  })

  it('an empty paper says so rather than drawing a blank sheet', () => {
    const { container } = render(<PaperPagesPreview blocks={[]} pagination={null} />)
    expect(sheets(container)).toHaveLength(0)
    expect(screen.getByText(/no content to preview/i)).toBeInTheDocument()
  })
})

describe('PaperPagesPreview — zoom is independent of pagination', () => {
  const pagination = measured([
    { pageNumber: 1, blockIndexes: [0, 1] },
    { pageNumber: 2, blockIndexes: [2, 3] },
  ])

  it('offers the five presets §1 asks for', () => {
    render(<PaperPagesPreview blocks={blocks} pagination={pagination} />)
    for (const label of ['Fit page', 'Fit width', '75%', '100%', '125%']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('scales the sheet without changing the page count or what is on each page', async () => {
    const user = userEvent.setup()
    const { container } = render(<PaperPagesPreview blocks={blocks} pagination={pagination} />)
    const before = [...sheets(container)].map((s) => s.textContent)

    await user.click(screen.getByRole('button', { name: '75%' }))

    expect(sheets(container)).toHaveLength(2)
    expect([...sheets(container)].map((s) => s.textContent)).toEqual(before)
    expect(sheets(container)[0].style.transform).toBe('scale(0.75)')

    await user.click(screen.getByRole('button', { name: '125%' }))
    expect(sheets(container)).toHaveLength(2)
    expect(sheets(container)[0].style.transform).toBe('scale(1.25)')
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
  })

  it('marks the active preset for assistive technology, not only visually', async () => {
    const user = userEvent.setup()
    render(<PaperPagesPreview blocks={blocks} pagination={pagination} />)
    await user.click(screen.getByRole('button', { name: '100%' }))
    expect(screen.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '75%' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('PaperPagesPreview — the paper code', () => {
  it('repeats on every sheet, the way it prints', () => {
    const { container } = render(
      <PaperPagesPreview
        blocks={blocks}
        footerCode="G5/Science/Term 1/2026"
        pagination={measured([
          { pageNumber: 1, blockIndexes: [0, 1] },
          { pageNumber: 2, blockIndexes: [2, 3] },
        ])}
      />,
    )
    expect(container.querySelectorAll('.pp-sheet-footer')).toHaveLength(2)
  })

  it('is absent when the paper has none', () => {
    const { container } = render(<PaperPagesPreview blocks={blocks} pagination={null} />)
    expect(container.querySelectorAll('.pp-sheet-footer')).toHaveLength(0)
  })
})
