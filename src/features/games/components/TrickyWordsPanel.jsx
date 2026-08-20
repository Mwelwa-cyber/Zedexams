/**
 * Your tricky words — the personal list.
 *
 * Everything else in the spelling system is packaging; this list is the
 * learning. It is also the honest answer to a parent asking what their child
 * is weak at, and the same records feed My Progress and the weekly report.
 *
 * IT IS NEVER A LEAGUE TABLE AND NEVER SHAMES. The counts are stated flatly
 * ("missed 3×"), the framing is that these are the words being worked on, and
 * there is no total-mistakes figure anywhere. A child who opens this screen
 * has to want to come back to it.
 *
 * A WORD LEAVES ON MASTERY, NOT ON A CORRECT ANSWER. `trickyRecords` reads the
 * same pool the ladder does, so a word disappears from here only after three
 * rights in three separate sessions — which is why the row says how many
 * sessions are left rather than just how many times it was missed.
 */
import { trickyRecords } from '../lib/spellingStagesCore'
import { TRICKY_STAGE_WORDS } from '../lib/spellingMapCore'

export default function TrickyWordsPanel({ pool = {}, onTakeOn, onBack }) {
  const records = trickyRecords(pool)

  return (
    <div className="lhx-sp-tricky">
      <header className="lhx-sp-map-head">
        <button type="button" className="lhx-sp-back" onClick={onBack} aria-label="Back to the stage map">‹</button>
        <h1 className="lhx-sp-map-title">Tricky words</h1>
        <span className="lhx-sp-starchip">📌 {records.length}</span>
      </header>

      <section className="lhx-sp-tricky-hero">
        <span className="lhx-sp-tricky-badge" aria-hidden="true">📌</span>
        <h2>Your tricky words</h2>
        {records.length > 0 ? (
          <p>
            The {records.length} {records.length === 1 ? 'word' : 'words'} you keep missing — nobody else has this list.
          </p>
        ) : (
          // The empty state is a real state, not a gap. A learner with nothing
          // here is not missing a feature; they are up to date.
          <p>Nothing here right now. Every word you have missed has been mastered — well done.</p>
        )}
      </section>

      {records.length > 0 && (
        <section className="lhx-sp-list">
          <h2>Still working on</h2>
          {records.slice(0, 12).map((record) => (
            <p key={record.word} className="lhx-sp-list-row">
              {String(record.word).toLowerCase()}
              <em>
                missed {record.misses}×
                {record.sessionsToMastery > 0 && ` · ${record.sessionsToMastery} to go`}
              </em>
            </p>
          ))}
          {records.length > 12 && <p className="lhx-sp-list-more">…and {records.length - 12} more</p>}
        </section>
      )}

      {records.length > 0 && (
        <button type="button" className="lhx-sp-cta" onClick={onTakeOn}>
          Take them on{records.length > TRICKY_STAGE_WORDS ? ` — ${TRICKY_STAGE_WORDS} at a time` : ''}
        </button>
      )}
      <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onBack}>Back to the map</button>
    </div>
  )
}
