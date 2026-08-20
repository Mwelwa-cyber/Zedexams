/**
 * §3 — the coaching panel. The part that actually teaches.
 *
 * Four blocks, in this order:
 *   1. Zed reacting + "Nice one!" / "Not quite — the correct answer is B — an"
 *   2. Why B is right
 *   3. Why YOUR answer is wrong — only when they got it wrong, and specific to
 *      the option they picked. A generic "the answer is B" does not teach.
 *   4. Remember it like this — a worked example or a memory hook
 *   + links to the note for that topic and a game that covers it
 *
 * ── What this component is NOT allowed to decide ─────────────────────────
 *
 * Whether the prose may be shown. That is `resolveCoaching`'s (§4.1's hard
 * rule), and it is enforced by the SHAPE of what this component is handed:
 * every prose field arrives empty unless a human approved it, so rendering
 * "whatever I was given" is the safe behaviour rather than the dangerous one.
 * There is no `if (approved)` in here to forget.
 */

import { Link } from 'react-router-dom'

import { coachingHeadline, coachingSubline } from '../lib/coaching'
import ZedReaction from './ZedReaction'
import { IconBook, IconPlay } from './QuizIcons'

export default function CoachingPanel({ coaching, seed, noteHref, gameHref, gameLabel }) {
  if (!coaching) return null
  const { correct, why, mistake, example, answerLetter, chosenLetter } = coaching

  return (
    // aria-live: the verdict has to reach a screen reader that is not looking
    // at the colour of the option. `polite` rather than `assertive` because
    // the learner just acted — they are waiting for this, not being
    // interrupted by it.
    <div className={`pq-coach ${correct ? 'is-good' : 'is-bad'}`} aria-live="polite">
      <div className="pq-coach-head">
        <div className="pq-zed">
          <ZedReaction pose={correct ? 'celebrate' : 'oops'} />
        </div>
        <div>
          <h3>{coachingHeadline({ correct, seed })}</h3>
          <p>{coachingSubline(coaching)}</p>
        </div>
      </div>

      {(why || mistake || example) && (
        <div className="pq-coach-body">
          {why && (
            <div className="pq-coach-block is-why">
              <div className="pq-bar" aria-hidden="true" />
              <div>
                <h4>{answerLetter ? `Why ${answerLetter} is right` : 'Why'}</h4>
                <p>{why}</p>
              </div>
            </div>
          )}
          {mistake && (
            <div className="pq-coach-block is-mistake">
              <div className="pq-bar" aria-hidden="true" />
              <div>
                <h4>{chosenLetter ? `Why ${chosenLetter} is wrong` : 'What went wrong'}</h4>
                <p>{mistake}</p>
              </div>
            </div>
          )}
          {example && (
            <div className="pq-coach-block is-eg">
              <div className="pq-bar" aria-hidden="true" />
              <div>
                <h4>Remember it like this</h4>
                <p><span className="pq-eg-line">{example}</span></p>
              </div>
            </div>
          )}
        </div>
      )}

      {(noteHref || gameHref) && (
        <div className="pq-coach-links">
          {noteHref && (
            <Link className="pq-chip" to={noteHref}>
              <IconBook size={14} />
              Read the note
            </Link>
          )}
          {gameHref && (
            <Link className="pq-chip" to={gameHref}>
              <IconPlay size={14} />
              {`Play ${gameLabel}`}
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
