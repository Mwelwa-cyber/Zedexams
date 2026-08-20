/**
 * The results screen — the same screen for both modes, deliberately.
 *
 * An exam's rows come from the server (§5.2) and practice's are marked in the
 * browser (§5.4), but both arrive here in the shape `attemptMarking` produces,
 * so there is one results screen rather than two that slowly diverge.
 *
 * Five sections, in the order a learner actually wants them:
 *   1. the hero + score ring — the number they came for
 *   2. how each part went — where the marks came from
 *   3. what to work on next — ranked by what it cost them
 *   4. go through the paper — every question, filterable
 *   5. what next — the fix-up set, another go, back to papers
 *
 * ── The one thing that is free on every plan, permanently ────────────────
 *
 * All of it. §8: "feedback on work already done is never charged for."
 * Marking, wrong answers and weak-topic advice for questions the learner has
 * ANSWERED cost nothing on any plan, so there is no entitlement check anywhere
 * in this file and none belongs here.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { BAND_LABEL, barTone, chosenText, filterRows, reviewFilters, verdictBand } from '../lib/attemptMarking'
import { formatDuration } from '../lib/examClock'
import { correctText, resolveCoaching } from '../lib/coaching'
import { optionLabel } from '../lib/answerKey'
import { isExam } from '../lib/quizModes'
import ProgressRing from './ProgressRing'
import ZedReaction from './ZedReaction'
import { IconBolt, IconBook, IconChevronDown, IconPlay } from './QuizIcons'

function AnswerRow({ row, question, onOpenNote, onOpenGame }) {
  const [open, setOpen] = useState(false)
  const coaching = useMemo(
    () => resolveCoaching({ question, selectedIndex: row.selectedIndex, correctIndex: row.correctIndex }),
    [question, row.selectedIndex, row.correctIndex],
  )
  const badge = row.correct ? 'is-ok' : row.blank ? 'is-skip' : 'is-no'
  const stem = (question?.text || '').replace(/<[^>]+>/g, '').trim()

  return (
    <div className={`pq-ans-row ${open ? 'is-open' : ''}`}>
      <button type="button" className="pq-ans-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`pq-ans-badge ${badge}`}>{row.n}</span>
        <span className="pq-t">
          <b>{stem || `Question ${row.n}`}</b>
          <span>{[row.name, row.topic].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="pq-ans-chev"><IconChevronDown size={18} /></span>
      </button>
      {open && (
        <div className="pq-ans-detail">
          <div className="pq-ans-line">
            <span className="pq-lab">You put</span>
            <span className={`pq-v ${row.correct ? 'is-ok' : 'is-no'}`}>
              {row.blank ? 'Nothing' : (optionLabel(question, row.selectedIndex) || chosenText(question, row))}
            </span>
          </div>
          <div className="pq-ans-line">
            <span className="pq-lab">Answer</span>
            <span className="pq-v is-ok">
              {optionLabel(question, row.correctIndex) || correctText(question, row.correctIndex) || '—'}
            </span>
          </div>
          {/* Prose only where a human approved it. `resolveCoaching` returns
              empty strings otherwise, so there is no gate to forget here. */}
          {coaching.why && (
            <div className="pq-ans-why">
              <b>Why</b>
              {coaching.why}
            </div>
          )}
          {coaching.mistake && (
            <div className="pq-ans-why">
              <b>{`Why ${coaching.chosenLetter} is wrong`}</b>
              {coaching.mistake}
            </div>
          )}
          {(coaching.noteRef || coaching.gameSlug) && (
            <div className="pq-focus-actions">
              {coaching.noteRef && (
                <Link className="pq-chip" to={`/notes?topic=${encodeURIComponent(coaching.noteRef)}`} onClick={() => onOpenNote(row.topicId)}>
                  <IconBook size={14} />
                  Read the note
                </Link>
              )}
              {coaching.gameSlug && (
                <Link className="pq-chip" to={`/games/${encodeURIComponent(coaching.gameSlug)}`} onClick={() => onOpenGame(coaching.gameSlug)}>
                  <IconPlay size={14} />
                  {`Play ${coaching.gameSlug.replace(/-/g, ' ')}`}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function QuizResults({
  paper,
  mode,
  marked,
  questions,
  timeUsedSec,
  flagCount,
  reason,
  unverifiedTiming,
  onFixup,
  onRetry,
  onDone,
  onOpenNote,
  onOpenGame,
}) {
  const [filter, setFilter] = useState('wrong')
  const exam = isExam(mode)
  const band = verdictBand(marked.percent)
  const questionById = useMemo(() => {
    const m = new Map()
    questions.forEach((q) => m.set(String(q.id), q))
    return m
  }, [questions])

  const headline = reason === 'timeup'
    ? 'Time is up!'
    : band === 'strong' ? 'Great work!' : 'Paper finished'
  const pose = band === 'strong' ? 'celebrate' : band === 'needs_work' ? 'oops' : 'neutral'

  const filters = reviewFilters(marked.rows)
  const visible = filterRows(marked.rows, filter)
  const wrongCount = marked.rows.filter((r) => !r.correct).length

  return (
    <div className="pq">
      <div className="pq-results">
        <div className="pq-res-hero">
          <div className="pq-zed-big"><ZedReaction pose={pose} /></div>
          {/* "Time is up!" — not an error, not a punishment. */}
          <h1>{headline}</h1>
          <p>{`${paper?.title || 'Past paper'} · ${exam ? 'Exam' : 'Practice'}`}</p>
        </div>

        <div className="pq-score-card">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <ProgressRing value={marked.right} max={marked.total} size={120} label="YOUR SCORE" idKey="result" />
          </div>
          <div className="pq-score-sub">{`${marked.percent}% · ${BAND_LABEL[band]}`}</div>
          <div className="pq-score-meta">
            {timeUsedSec != null && <div>Time used<b>{formatDuration(timeUsedSec)}</b></div>}
            <div>Blank<b>{marked.blanks}</b></div>
            {exam && <div>Flagged<b>{flagCount}</b></div>}
          </div>
          {!exam && (
            <p className="pq-fineprint" style={{ marginTop: 12 }}>
              Practice is not added to your exam record.
            </p>
          )}
          {/* §5.5 — an attempt that ran offline counts for the child's own
              history but never for any leaderboard. Said plainly rather than
              hidden, because a learner comparing two of their own scores
              deserves to know one was not timed against a server. */}
          {unverifiedTiming && (
            <p className="pq-fineprint">
              You sat this one offline, so the timing could not be checked. It still counts as yours.
            </p>
          )}
        </div>

        <div className="pq-res-body">
          <div className="pq-card">
            <h3>How each part went</h3>
            <p className="pq-sub">
              The paper is split the way the real one is. This is where your marks came from.
            </p>
            {marked.bySection.map((s) => (
              <div className="pq-bar-row" key={s.key}>
                <div className="pq-bar-head">
                  <span className="pq-name">{s.name}</span>
                  <span className="pq-val">{`${s.right}/${s.total}`}</span>
                </div>
                <div className="pq-bar-track">
                  <div className={`pq-bar-fill is-${barTone(s.percent)}`} style={{ width: `${s.percent}%` }} />
                </div>
                <div className="pq-bar-note">
                  {s.mostMissed ? `Most missed: ${s.mostMissed}` : 'All correct — nothing to fix here.'}
                </div>
              </div>
            ))}
          </div>

          {marked.weakTopics.length > 0 ? (
            <div className="pq-card">
              <h3>What to work on next</h3>
              <p className="pq-sub">Ranked by how many marks it cost you in this paper.</p>
              {marked.weakTopics.slice(0, 3).map((t, i) => (
                <div className="pq-focus" key={t.topicId}>
                  <div className="pq-focus-rank">{i + 1}</div>
                  <div className="pq-t">
                    <b>{t.topic || t.topicId}</b>
                    <span>
                      {`${t.section ? `${t.section} · ` : ''}lost ${t.missed} mark${t.missed > 1 ? 's' : ''}`}
                      {` (question${t.questions.length > 1 ? 's' : ''} ${t.questions.join(', ')})`}
                    </span>
                  </div>
                </div>
              ))}
              <div style={{ height: 14 }} />
              <button type="button" className="pq-cta" onClick={onFixup}>
                <IconBolt size={16} />
                {`Fix these ${wrongCount} question${wrongCount === 1 ? '' : 's'}`}
              </button>
              <p className="pq-fineprint">
                Opens in practice mode with only the questions you got wrong, explained one by one.
              </p>
            </div>
          ) : (
            <div className="pq-card">
              <h3>Nothing to fix</h3>
              <p className="pq-sub">You got every question right. Try the next paper.</p>
            </div>
          )}

          <div className="pq-card">
            <h3>Go through the paper</h3>
            <div className="pq-filters">
              {filters.map((f) => (
                <button
                  type="button"
                  key={f.id}
                  className="pq-fchip"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {`${f.label} ${f.count}`}
                </button>
              ))}
            </div>
            {visible.length === 0
              ? <p className="pq-sub" style={{ margin: 0 }}>Nothing here.</p>
              : visible.map((row) => (
                <AnswerRow
                  key={row.questionId}
                  row={row}
                  question={questionById.get(String(row.questionId))}
                  onOpenNote={onOpenNote}
                  onOpenGame={onOpenGame}
                />
              ))}
          </div>

          <div style={{ height: 16 }} />
          <button type="button" className="pq-cta is-secondary" onClick={onRetry}>
            Try the whole paper again
          </button>
          <div className="pq-stack" />
          <button type="button" className="pq-cta is-quiet" onClick={onDone}>
            Back to past papers
          </button>
        </div>
      </div>
    </div>
  )
}
