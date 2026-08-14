/**
 * QuizEditorPreviewPanel — image-position layout tests.
 *
 * The preview exists so a teacher/admin can trust what learners will see, so
 * the saved imagePosition must actually change the preview's layout (it used
 * to always render the image above the text, which made the IMAGE POSITION
 * dropdown look broken). The class map must mirror QuizRunnerV2's
 * IMAGE_POSITION_CLASSES.
 *
 * Run: npm run test:unit -- QuizEditorPreviewPanel
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import QuizEditorPreviewPanel from './QuizEditorPreviewPanel'

const FORM = { title: 'Grade 7 Science', subject: 'Integrated Science', grade: '7', duration: 30, topic: 'past-paper' }

function question(over = {}) {
  return {
    id: 'q1',
    type: 'mcq',
    text: '<p>Which diagram shows transpiration?</p>',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 0,
    imageUrl: 'https://storage.example/page.jpg',
    order: 0,
    ...over,
  }
}

function renderPanel(q) {
  return render(
    <QuizEditorPreviewPanel
      form={FORM}
      serializedSections={{ questions: [q], passages: [], questionCount: 1, totalMarks: 1 }}
    />,
  )
}

describe('QuizEditorPreviewPanel — imagePosition', () => {
  it('default (null) keeps the original stacked layout with no position wrapper', () => {
    const { container } = renderPanel(question())
    expect(container.querySelector('[data-image-position]')).toBeNull()
    expect(screen.getByAltText('Question illustration')).toBeInTheDocument()
  })

  it('"below" wraps image + text in a column-reverse flex container', () => {
    const { container } = renderPanel(question({ imagePosition: 'below' }))
    const wrap = container.querySelector('[data-image-position="below"]')
    expect(wrap).not.toBeNull()
    expect(wrap.className).toContain('flex-col-reverse')
    // The image lives INSIDE the wrapper so the reversal actually moves it.
    expect(wrap.querySelector('img')).not.toBeNull()
  })

  it('"left" and "right" use the responsive row layouts (mirroring the learner runner)', () => {
    const { container: left } = renderPanel(question({ imagePosition: 'left' }))
    expect(left.querySelector('[data-image-position="left"]').className).toContain('sm:flex-row')
    const { container: right } = renderPanel(question({ imagePosition: 'right' }))
    expect(right.querySelector('[data-image-position="right"]').className).toContain('sm:flex-row-reverse')
  })

  it('a position with no image renders the plain stacked layout (no empty wrapper)', () => {
    const { container } = renderPanel(question({ imageUrl: '', imagePosition: 'below' }))
    expect(container.querySelector('[data-image-position]')).toBeNull()
  })
})

describe('QuizEditorPreviewPanel — library diagrams (RENDER-001)', () => {
  // The preview read imageUrl only, so a question whose figure is a library
  // diagram previewed with NO figure at all — the teacher could not see the
  // shape they had just picked. DiagramSvg renders the catalog SVG inline
  // under role="img".
  it('renders a library diagram as the question figure', () => {
    const { container } = renderPanel(
      question({ imageUrl: '', imageDiagram: { libraryKey: 'cylinder', params: {} } }),
    )
    expect(container.querySelector('.zx-diagram-svg')).not.toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('positions a library diagram exactly as it positions an uploaded image', () => {
    const { container } = renderPanel(
      question({ imageUrl: '', imageDiagram: { libraryKey: 'cylinder', params: {} }, imagePosition: 'below' }),
    )
    const wrap = container.querySelector('[data-image-position="below"]')
    expect(wrap).not.toBeNull()
    expect(wrap.className).toContain('flex-col-reverse')
    // The diagram must live INSIDE the wrapper, or the reversal moves nothing
    // — the same requirement the uploaded-image case has.
    expect(wrap.querySelector('.zx-diagram-svg')).not.toBeNull()
  })

  it('a library diagram wins over a leftover imageUrl, and only one figure renders', () => {
    const { container } = renderPanel(
      question({ imageUrl: 'https://storage.example/stale.jpg', imageDiagram: { libraryKey: 'cylinder', params: {} } }),
    )
    expect(container.querySelector('.zx-diagram-svg')).not.toBeNull()
    expect(screen.queryByAltText('Question illustration')).toBeNull()
  })

  it('an imageDiagram with no libraryKey falls back to the uploaded image', () => {
    // The field is sometimes present as {} — that renders nothing, so it must
    // not shadow a perfectly good photo.
    renderPanel(question({ imageDiagram: {} }))
    expect(screen.getByAltText('Question illustration')).toBeInTheDocument()
  })
})
