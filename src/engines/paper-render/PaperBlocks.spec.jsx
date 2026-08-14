import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PaperBlock } from './PaperBlocks.jsx'
import { buildAssessmentDocument } from '../../utils/assessmentDocument.js'
import { buildPrintableHtml } from '../../utils/assessmentToPdf.js'

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

// The marking key's twin figure (§4.3). One source, two renderings: the learner
// gets numbers, the teacher gets the same numbers plus the names. The first
// test is the one that matters — an answer must never reach the learner.

const identifyBlock = (showAnswer) => ({
  kind: 'question',
  type: 'diagram',
  number: 4,
  marks: 2,
  text: 'Name the parts of the heart.',
  imageUrl: 'https://example.test/heart.png',
  diagramMode: 'identify',
  showAnswer,
  diagramLabels: [
    { x: 0.25, y: 0.3, text: 'Aorta' },
    { x: 0.6, y: 0.55, text: 'Left ventricle' },
  ],
})

describe('PaperBlocks — marking-key figure', () => {
  afterEach(cleanup)

  it('never shows an answer on the learner copy', () => {
    const { container } = render(<PaperBlock block={identifyBlock(false)} />)
    expect(container.textContent).not.toContain('Aorta')
    expect(container.textContent).not.toContain('Left ventricle')
    expect(labelPills(container).map((p) => p.textContent)).toEqual(['1', '2'])
  })

  it('names the parts on the marking key', () => {
    const { container } = render(<PaperBlock block={identifyBlock(true)} />)
    expect(container.textContent).toContain('Aorta')
    expect(container.textContent).toContain('Left ventricle')
    // The numbers are still there — they are what makes the copies correspond.
    const texts = labelPills(container).map((p) => p.textContent)
    expect(texts).toContain('1')
    expect(texts).toContain('2')
  })

  it('puts the numbers in identical places on both copies', () => {
    const at = (showAnswer) => {
      const { container } = render(<PaperBlock block={identifyBlock(showAnswer)} />)
      const spots = labelPills(container)
        .filter((p) => /^\d+$/.test(p.textContent))
        .map((p) => `${p.style.left},${p.style.top}`)
      cleanup()
      return spots
    }
    expect(at(false)).toEqual(at(true))
  })
})

/* ────────────────────────────────────────────────────────────────────────
 * Rich paper text
 *
 * The preview rendered the PLAIN mirror of a question stem and its options
 * while the PDF and Word rendered the rich HTML published beside it, so a bold
 * word, a superscript or a stacked fraction printed correctly and previewed as
 * flat text. A teacher proof-reading on screen could not see what they were
 * about to hand out.
 *
 * These go through the real `buildAssessmentDocument` rather than hand-written
 * blocks: the defect was that this renderer read a different FIELD of the block
 * than the exports did, so a test that hand-builds the block chooses the answer
 * it is meant to be checking.
 * ─────────────────────────────────────────────────────────────────────── */

const richStem = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'The formula for water is ' },
      { type: 'text', marks: [{ type: 'bold' }], text: 'H' },
      { type: 'text', marks: [{ type: 'bold' }, { type: 'subscript' }], text: '2' },
      { type: 'text', marks: [{ type: 'bold' }], text: 'O' },
      { type: 'text', text: '. The area is 5cm' },
      { type: 'text', marks: [{ type: 'superscript' }], text: '2' },
    ],
  }],
}

const fractionOption = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'mathFraction', attrs: { whole: '', num: '3', den: '4' } }],
  }],
}

function renderPaper(question) {
  const model = buildAssessmentDocument(
    { title: 'T', subject: 'Integrated Science', grade: '6', questions: [] },
    [{ id: 'q1', order: 1, type: 'mcq', marks: 2, correctAnswer: 0, ...question }],
    { mode: 'paper' },
  )
  const block = model.blocks.find((b) => b.kind === 'question')
  return { block, ...render(<PaperBlock block={block} />) }
}

describe('PaperBlocks — rich paper text', () => {
  afterEach(cleanup)

  it('keeps bold, subscript and superscript in the question stem', () => {
    const { container } = renderPaper({ text: richStem, options: ['a', 'b', 'c', 'd'] })
    const body = container.querySelector('.sv-qbody')
    expect(body).toBeTruthy()
    expect(body.querySelector('strong')).toBeTruthy()
    expect(body.querySelector('sub').textContent).toBe('2')
    expect(body.querySelector('sup').textContent).toBe('2')
    // The reading order still has to be right — marked-up runs are easy to
    // render in the wrong place.
    expect(body.textContent).toBe('The formula for water is H2O. The area is 5cm2')
  })

  it('never prints the raw markup of a formatted stem', () => {
    const { container } = renderPaper({ text: richStem, options: ['a', 'b', 'c', 'd'] })
    expect(container.textContent).not.toContain('<strong>')
    expect(container.textContent).not.toContain('"type"')
  })

  it('stacks a fraction option instead of flattening it to "34"', () => {
    // The failure this guards is specific: the flattened markup for 3/4 is a
    // stack of two spans, so rendering it WITHOUT the numerator/denominator
    // styling reads as "34" — worse than the "3/4" plain text it replaced.
    const { container } = renderPaper({ text: 'Which is largest?', options: [fractionOption, '1/2', '1/5', '1/8'] })
    const stack = container.querySelector('.sv-opt-rich .math-frac-stack')
    expect(stack).toBeTruthy()
    expect(stack.querySelector('.math-frac-num').textContent).toBe('3')
    expect(stack.querySelector('.math-frac-den').textContent).toBe('4')
  })

  it('falls back to the plain mirror when a question has no rich twin', () => {
    // A block built by a caller that predates textHtml, or a legacy question
    // stored as plain text. This is the path every existing paper takes.
    const { container } = render(<PaperBlock block={{
      kind: 'question', type: 'mcq', number: 3, marks: 1,
      text: 'Name the largest planet.', options: [], optionsPlain: [],
    }} />)
    expect(container.textContent).toContain('Name the largest planet.')
    expect(container.querySelector('.sv-qbody')).toBeNull()
  })

  it('still shows the placeholder for a question with no text at all', () => {
    // An empty editor paragraph is not content: rendering it would replace the
    // placeholder with a blank line, which reads as a rendering failure.
    const { container } = render(<PaperBlock block={{
      kind: 'question', type: 'mcq', number: 4, marks: 1,
      text: '', textHtml: '<p></p>', options: [], optionsPlain: [],
    }} />)
    expect(container.textContent).toContain('(no question text)')
  })

  it('shows the teacher the same content the print window builds', () => {
    // The two renderers reading DIFFERENT fields of the same block is the whole
    // defect, so this asserts on the actual print HTML rather than restating
    // what the preview does.
    const { block, container } = renderPaper({ text: richStem, options: ['a', 'b', 'c', 'd'] })
    const printed = buildPrintableHtml(
      { title: 'T', subject: 'Integrated Science', grade: '6' },
      [{ id: 'q1', order: 1, type: 'mcq', marks: 2, correctAnswer: 0, text: richStem, options: ['a', 'b', 'c', 'd'] }],
      'paper',
    )
    expect(printed).toContain(block.textHtml)
    expect(container.querySelector('.sv-qbody').innerHTML).toBe(block.textHtml)
  })
})
