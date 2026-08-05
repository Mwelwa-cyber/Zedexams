/**
 * `render/` — the engine's question renderers, and what they refuse to draw.
 *
 * The first engine code a learner will actually see. Two things about that
 * shape everything here:
 *
 *   1. **Presentation decisions are pure where they can be.** `choiceRows.js`
 *      computes letters, selection and verdict visibility with no DOM, so the
 *      rules a reviewer cares about are node-testable and the components only
 *      map rows to elements. A layout that decides things cannot be asserted
 *      without a browser, and the things worth asserting here — that an exam
 *      never leaks the key into the DOM, that letters come from the shared
 *      rule — are exactly the ones you want assertable cheaply.
 *      `purity.test.js` deliberately does not scan this directory — the
 *      components import React, which is the point of them. The pure modules
 *      here are covered by something stronger than a source scan: their tests
 *      RUN under plain node, so a browser dependency creeping in fails them
 *      outright rather than being pattern-matched for.
 *   2. **The gap is declared.** `supportedTypes.js` names every type the engine
 *      cannot draw yet and the dispatcher refuses one rather than rendering an
 *      unanswerable question. `unrenderableTypes()` is the question a cutover
 *      asks before a learner is shown anything.
 */
export { default as QuestionRenderer } from './QuestionRenderer.jsx'
export { default as ChoiceQuestion } from './ChoiceQuestion.jsx'
export { default as QuestionPrompt } from './QuestionPrompt.jsx'
export { buildChoiceRows, isAnswerable } from './choiceRows.js'
export {
  SUPPORTED,
  UNSUPPORTED,
  canRender,
  unsupportedReason,
  unrenderableTypes,
} from './supportedTypes.js'
