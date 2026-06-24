import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PaperBlock } from './PaperBlocks.jsx'

// Regression guard for the "test paper studio images too big" bug.
//
// Image-mode MCQ options used to lay out in a `repeat(4, 1fr)` grid, so each
// picture stretched to a quarter of the paper width. On a wide preview (or any
// render where `.sv-paper` isn't width-capped) that ballooned the option
// images to 300px+ and overflowed the page. The fix pins each option cell to a
// fixed 140px track — the SAME size the DOCX exporter uses (loadImageRun
// width:140 in assessmentToDocx.js) — so the preview and the download agree
// and the images can never scale with the container width again.

const imageMcqBlock = {
  kind: 'question',
  type: 'mcq',
  number: 11,
  marks: 1,
  text: 'Which shape below is a rectangle?',
  optionsMode: 'image',
  options: ['', '', '', ''],
  optionMedia: [
    { imageUrl: 'https://example.test/triangle.png', alt: 'triangle' },
    { imageUrl: 'https://example.test/rectangle.png', alt: 'rectangle' },
    { imageUrl: 'https://example.test/circle.png', alt: 'circle' },
    { imageUrl: 'https://example.test/pentagon.png', alt: 'pentagon' },
  ],
  correctAnswer: 1,
}

function findImageOptionGrid(container) {
  // The grid is the element that lays its option cells out as a CSS grid.
  return Array.from(container.querySelectorAll('div')).find(
    (el) => el.style.display === 'grid' && el.querySelector('img'),
  )
}

describe('PaperBlocks — image MCQ options', () => {
  afterEach(cleanup)

  it('caps each option image at a fixed 140px track (never 1fr / quarter-width)', () => {
    const { container } = render(<PaperBlock block={imageMcqBlock} />)
    const grid = findImageOptionGrid(container)
    expect(grid).toBeTruthy()
    // Fixed-width tracks, not a stretch-to-fit fraction.
    expect(grid.style.gridTemplateColumns).toContain('140px')
    expect(grid.style.gridTemplateColumns).not.toContain('1fr')
    // Centred so a short row of options doesn't hug the left margin.
    expect(grid.style.justifyContent).toBe('center')
  })

  it('renders one image per option', () => {
    const { container } = render(<PaperBlock block={imageMcqBlock} />)
    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(4)
    // Images stay contained within their (now bounded) cell.
    for (const img of imgs) {
      expect(img.style.maxWidth).toBe('100%')
      expect(img.style.maxHeight).toBe('100%')
    }
  })
})
