/**
 * What Chromium actually runs — one fixture, mounted for real.
 *
 * This is bundled by `screenStage.mjs` and injected into the page. It has to be
 * a real client mount rather than a string of HTML, and that is the finding the
 * whole family rests on: `RichContent` renders rich content from a `useEffect`
 * and hydrates KaTeX in a `setTimeout`, so under server rendering a stacked
 * fraction collapses to a bare slash — the exact form §4.1 forbids. Anything
 * that does not run effects cannot see the requirement this gate exists for.
 *
 * `window.__screenReady` is set once React has committed and the KaTeX
 * hydration timeout has had a turn. The stage waits on it rather than on a
 * fixed sleep: a sleep long enough to be safe on a slow runner is wasted on
 * every fast one, and a sleep short enough to be quick screenshots a half-drawn
 * page and files it as the reference.
 */
import { createRoot } from 'react-dom/client'
import QuestionRenderer from '../../../src/engines/assessment-engine/render/QuestionRenderer.jsx'
import ChoiceQuestion from '../../../src/engines/assessment-engine/render/ChoiceQuestion.jsx'
import QuestionPrompt from '../../../src/engines/assessment-engine/render/QuestionPrompt.jsx'
import { SCREEN_FIXTURES } from './screenFixtures.js'

/** The fixture id is stamped into the page by the stage before this runs. */
const fixture = SCREEN_FIXTURES.find((f) => f.id === window.__screenFixtureId)
if (!fixture) {
  // Never render an empty page: a blank screenshot recorded as a baseline is
  // the failure this whole family is built to avoid.
  throw new Error(`no screen fixture "${window.__screenFixtureId}"`)
}

function Fixture() {
  // The unanswerable-question fixture goes through `ChoiceQuestion` directly,
  // because `QuestionRenderer` draws a prompt above it and the thing under test
  // is the fault message on its own.
  if (fixture.question.options.length === 0) {
    return (
      <>
        <QuestionPrompt question={fixture.question} number={fixture.number} />
        <ChoiceQuestion question={fixture.question} answer={null} />
      </>
    )
  }
  return (
    <QuestionRenderer
      question={fixture.question}
      answer={fixture.answer}
      revealed={fixture.revealed}
      number={fixture.number}
      onAnswer={() => {}}
    />
  )
}

const root = document.getElementById('root')
createRoot(root).render(
  // `quiz-shell` is what the reading-preference custom properties hang off in
  // the app. Rendering outside it would measure the fallbacks rather than the
  // values a learner's settings actually produce.
  <div className="quiz-shell" data-quiz-theme="default">
    <div className="zx-screen-fixture">
      <Fixture />
    </div>
  </div>,
  {
    onUncaughtError: (error) => {
      window.__screenError = String(error?.message ?? error)
    },
  },
)

// Two frames plus a macrotask: the first commit, then the `setTimeout(0)` that
// `RichContent` uses to hydrate KaTeX, then a frame for it to paint.
requestAnimationFrame(() => {
  setTimeout(() => {
    requestAnimationFrame(() => {
      window.__screenReady = true
    })
  }, 0)
})
