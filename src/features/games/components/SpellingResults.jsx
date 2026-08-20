/**
 * The end of a stage.
 *
 * Stars for ACCURACY, never speed — 3★ is every word right first time, 2★ is
 * most of them, 1★ is finishing. Time is recorded (My Progress and the weekly
 * report read it) and is never scored, because a spelling game that rewarded
 * speed would reward guessing.
 *
 * The three lists under the stars are the part that actually reports learning,
 * and they are three different facts rather than one:
 *
 *   MASTERED — words that crossed the line THIS stage. Mastery is three rights
 *   in three separate sessions, so this is a real claim and rare enough to be
 *   worth the celebration it gets.
 *
 *   ADDED TO YOUR TRICKY WORDS — words that were not on the list before. A word
 *   that was already tricky and was missed again is NOT here: listing it would
 *   tell a learner they had gone backwards when they had simply not got there
 *   yet.
 *
 *   COMING BACK — every unmastered word with the stage it returns in. This is
 *   the promise the whole spacing model makes, said out loud, so a learner
 *   knows the word is not gone and is not being punished for missing it.
 *
 * "Try again for 3 stars" is offered whenever there are stars left to win, and
 * the copy states the thing that makes replaying safe: nothing is lost by it.
 */
import { TRICKY_STAGE } from '../lib/spellingMapCore'

function BigStars({ count }) {
  return (
    <p className="lhx-sp-bigstars" aria-label={`${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < count ? '' : 'is-off'} aria-hidden="true">★</span>
      ))}
    </p>
  )
}

export default function SpellingResults({
  stage,
  summary,
  bestStreak = 0,
  previousStars = 0,
  hasNextStage = true,
  saveNote = null,
  onNext,
  onReplay,
  onMap,
}) {
  const { stars, firstTryCorrect, words, mastered, addedTricky, returning } = summary
  const improved = stars > previousStars
  const isTricky = stage === TRICKY_STAGE

  return (
    <div className="lhx-sp-results">
      <header className="lhx-sp-map-head">
        <button type="button" className="lhx-sp-back" onClick={onMap} aria-label="Back to the stage map">‹</button>
        <h1 className="lhx-sp-map-title">{isTricky ? 'Tricky words' : `Stage ${stage}`}</h1>
      </header>

      <section className="lhx-sp-win">
        {!isTricky && <BigStars count={stars} />}
        <p className="lhx-sp-win-title">{isTricky ? 'Practice done' : 'Stage cleared'}</p>
        <p className="lhx-sp-win-sub">
          {firstTryCorrect} of {words} right first time
          {bestStreak > 1 && ` · best streak ${bestStreak}`}
        </p>
        {improved && previousStars > 0 && (
          <p className="lhx-sp-win-improved">Better than last time — {previousStars}★ → {stars}★</p>
        )}
        {!improved && previousStars > stars && (
          // Said explicitly, because a learner who scores worse on a replay
          // needs to know their rating did not drop. It is the thing that
          // makes practising safe.
          <p className="lhx-sp-win-kept">You keep your {previousStars}★ from before — nothing is lost by replaying.</p>
        )}
      </section>

      {mastered.length > 0 && (
        <section className="lhx-sp-list">
          <h2>✓ Mastered — these are yours now</h2>
          {mastered.map((word) => (
            <p key={word} className="lhx-sp-list-row">
              {String(word).toLowerCase()}<em>3rd time right</em>
            </p>
          ))}
        </section>
      )}

      {addedTricky.length > 0 && (
        <section className="lhx-sp-list">
          <h2>📌 Added to your tricky words</h2>
          {addedTricky.map((word) => (
            <p key={word} className="lhx-sp-list-row">
              {String(word).toLowerCase()}<em>back in a couple of stages</em>
            </p>
          ))}
        </section>
      )}

      {returning.length > 0 && (
        <section className="lhx-sp-list">
          <h2>Coming back</h2>
          {returning.slice(0, 6).map((row) => (
            <p key={row.word} className="lhx-sp-list-row">
              {String(row.word).toLowerCase()}
              <em>{row.dueAt ? `stage ${row.dueAt}` : 'soon'}</em>
            </p>
          ))}
          {returning.length > 6 && <p className="lhx-sp-list-more">…and {returning.length - 6} more</p>}
        </section>
      )}

      {saveNote && <p className="lhx-sp-savenote">{saveNote}</p>}

      {stars < 3 && !isTricky && (
        <p className="lhx-sp-next-note">
          <b>Three stars needs {words} of {words} first time</b>
          Stage {stage} stays open — try it again whenever you like. Nothing is lost by replaying.
        </p>
      )}

      {hasNextStage && !isTricky && (
        <button type="button" className="lhx-sp-cta" onClick={onNext}>Next stage →</button>
      )}
      {stars < 3 && !isTricky && (
        <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onReplay}>
          Try stage {stage} again for 3 stars
        </button>
      )}
      <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onMap}>
        Back to the map
      </button>
    </div>
  )
}
