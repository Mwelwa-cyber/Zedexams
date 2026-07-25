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

// Figure labels (§4.2). The preview places labels through the same resolver as
// the print window and the Word export, so what a teacher separates on screen
// is what prints. Two things are worth pinning here because they are invisible
// in a passing render: two labels on one point must not stack, and a leader
// line must leave the pill rather than start underneath it.

const labelledDiagramBlock = (diagramLabels) => ({
  kind: 'question',
  type: 'diagram',
  number: 4,
  marks: 3,
  text: 'Name the parts of the heart.',
  imageUrl: 'https://example.test/heart.png',
  diagramMode: 'labeled',
  diagramLabels,
})

const labelPills = (container) => Array.from(container.querySelectorAll('span'))
  .filter((el) => el.style.position === 'absolute' && el.style.left)

describe('PaperBlocks — figure labels', () => {
  afterEach(cleanup)

  it('leaves well-separated labels exactly where the teacher put them', () => {
    const { container } = render(<PaperBlock block={labelledDiagramBlock([
      { x: 0.15, y: 0.2, text: 'Aorta' },
      { x: 0.8, y: 0.8, text: 'Apex' },
    ])} />)
    const pills = labelPills(container)
    expect(pills.map((p) => p.style.left)).toEqual(['15%', '80%'])
    expect(container.querySelector('svg')).toBeNull()
  })

  it('separates two labels dropped on the same point', () => {
    const { container } = render(<PaperBlock block={labelledDiagramBlock([
      { x: 0.5, y: 0.5, text: 'Atrium' },
      { x: 0.5, y: 0.5, text: 'Ventricle' },
    ])} />)
    const pills = labelPills(container)
    expect(pills).toHaveLength(2)
    const same = pills[0].style.left === pills[1].style.left
      && pills[0].style.top === pills[1].style.top
    expect(same).toBe(false)
  })

  it('draws the leader line from the pill\'s edge, not its centre', () => {
    const { container } = render(<PaperBlock block={labelledDiagramBlock([
      { x: 0.25, y: 0.5, tx: 0.85, ty: 0.5, text: 'Aorta' },
    ])} />)
    const line = container.querySelector('line')
    expect(line).toBeTruthy()
    // Target is to the right, so the line starts to the right of the centre.
    expect(parseFloat(line.getAttribute('x1'))).toBeGreaterThan(25)
    expect(parseFloat(line.getAttribute('x2'))).toBeCloseTo(85, 1)
    // And the dot sits on the part, at the line's far end.
    expect(parseFloat(container.querySelector('circle').getAttribute('cx'))).toBeCloseTo(85, 1)
  })

  it('numbers identify markers in the authored order', () => {
    const { container } = render(<PaperBlock block={{
      ...labelledDiagramBlock([
        { x: 0.5, y: 0.5, text: 'Atrium' },
        { x: 0.5, y: 0.5, text: 'Ventricle' },
      ]),
      diagramMode: 'identify',
    }} />)
    expect(labelPills(container).map((p) => p.textContent)).toEqual(['1', '2'])
  })
})
