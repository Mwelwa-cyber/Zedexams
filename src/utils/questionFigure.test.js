/**
 * questionFigure — figure precedence + position wrapper rules.
 *
 * Run: node src/utils/questionFigure.test.js   (npm run test:question-figure)
 */
import assert from 'node:assert'
import {
  IMAGE_POSITION_CLASSES,
  imagePositionClasses,
  usesFigurePositionWrapper,
  resolveQuestionFigure,
  hasQuestionFigure,
} from './questionFigure.js'

function runPositionClassTest() {
  // The stacked positions must be byte-identical to each other: `inline` has
  // never had a distinct rendering, and a surface that started treating it as
  // one would silently re-lay-out every paper that stored it.
  assert.equal(IMAGE_POSITION_CLASSES.inline, IMAGE_POSITION_CLASSES.above, 'inline renders as above')
  assert.match(IMAGE_POSITION_CLASSES.below, /flex-col-reverse/, 'below reverses the column')
  assert.match(IMAGE_POSITION_CLASSES.left, /sm:flex-row(?!-reverse)/, 'left is a plain responsive row')
  assert.match(IMAGE_POSITION_CLASSES.right, /sm:flex-row-reverse/, 'right is the reversed row')

  // Unknown/absent degrades to the pre-field layout, never to nothing.
  assert.equal(imagePositionClasses(undefined), IMAGE_POSITION_CLASSES.above, 'absent → above')
  assert.equal(imagePositionClasses(null), IMAGE_POSITION_CLASSES.above, 'null → above')
  assert.equal(imagePositionClasses('sideways'), IMAGE_POSITION_CLASSES.above, 'garbage → above')
  assert.equal(imagePositionClasses('below'), IMAGE_POSITION_CLASSES.below, 'below → below')

  console.log('runPositionClassTest passed (class map + fallback)')
}

function runWrapperDecisionTest() {
  // A wrapper only when there is BOTH a figure and a non-stacked position.
  assert.equal(usesFigurePositionWrapper('below', true), true, 'below + figure wraps')
  assert.equal(usesFigurePositionWrapper('left', true), true, 'left + figure wraps')
  assert.equal(usesFigurePositionWrapper('right', true), true, 'right + figure wraps')

  assert.equal(usesFigurePositionWrapper('above', true), false, 'above stays stacked')
  assert.equal(usesFigurePositionWrapper('inline', true), false, 'inline stays stacked')
  assert.equal(usesFigurePositionWrapper(null, true), false, 'no position stays stacked')

  // The case that produces an empty flex box claiming a layout the question
  // does not have — a position set on a question whose figure was removed.
  assert.equal(usesFigurePositionWrapper('below', false), false, 'below with no figure does NOT wrap')
  assert.equal(usesFigurePositionWrapper('left', false), false, 'left with no figure does NOT wrap')

  console.log('runWrapperDecisionTest passed (wrapper only for figure + non-stacked position)')
}

function runFigurePrecedenceTest() {
  const diagram = resolveQuestionFigure({
    imageDiagram: { libraryKey: 'cylinder', params: { r: 2 } },
  })
  assert.equal(diagram.kind, 'diagram')
  assert.equal(diagram.libraryKey, 'cylinder')
  assert.deepEqual(diagram.params, { r: 2 })

  const image = resolveQuestionFigure({ imageUrl: 'https://x/i.jpg' })
  assert.equal(image.kind, 'image')
  assert.equal(image.imageUrl, 'https://x/i.jpg')

  // Both set (stale Firestore data — the editor enforces exclusivity): the
  // authored diagram wins and the leftover photo is NOT also rendered.
  const both = resolveQuestionFigure({
    imageDiagram: { libraryKey: 'trapezium' },
    imageUrl: 'https://x/stale.jpg',
  })
  assert.equal(both.kind, 'diagram', 'diagram beats a leftover imageUrl')
  assert.equal(both.imageUrl, '', 'the losing image is not carried through')
  assert.deepEqual(both.params, {}, 'missing params default to {}')

  // A diagram object with no libraryKey renders nothing, so it must not
  // shadow a perfectly good uploaded image.
  const keyless = resolveQuestionFigure({ imageDiagram: {}, imageUrl: 'https://x/real.jpg' })
  assert.equal(keyless.kind, 'image', 'a keyless imageDiagram does not shadow imageUrl')
  const paramsOnly = resolveQuestionFigure({ imageDiagram: { params: { r: 1 } }, imageUrl: 'https://x/real.jpg' })
  assert.equal(paramsOnly.kind, 'image', 'params without a libraryKey does not shadow imageUrl')

  assert.equal(resolveQuestionFigure({}).kind, 'none')
  assert.equal(resolveQuestionFigure(null).kind, 'none', 'null question does not throw')
  assert.equal(resolveQuestionFigure(undefined).kind, 'none', 'undefined question does not throw')
  assert.equal(resolveQuestionFigure({ imageUrl: '' }).kind, 'none', 'empty imageUrl is not a figure')

  assert.equal(hasQuestionFigure({ imageDiagram: { libraryKey: 'cone' } }), true)
  assert.equal(hasQuestionFigure({ imageUrl: 'https://x/i.jpg' }), true)
  assert.equal(hasQuestionFigure({}), false)
  assert.equal(hasQuestionFigure({ imageDiagram: {} }), false, 'keyless diagram is not a figure')

  console.log('runFigurePrecedenceTest passed (diagram > image > none)')
}

runPositionClassTest()
runWrapperDecisionTest()
runFigurePrecedenceTest()
console.log('All questionFigure tests passed.')
