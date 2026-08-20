/**
 * The three bottom sheets: the review grid, the submit confirmation, and the
 * exit warning.
 *
 * ── The rule all three share ─────────────────────────────────────────────
 *
 * §8's carried-over guardrail: "the 'leave' path always has a way out that is
 * not the guardian and not a dead end." Every sheet here has at least two ways
 * out and the least destructive one is the primary button. The exit sheet has
 * three (stay · switch to practice · leave and void) and that is the point of
 * it — a learner who taps "back" mid-exam is usually not trying to throw the
 * paper away, they are trying to escape a screen.
 *
 * The exit sheet is also the only one a scrim tap cannot close, because
 * dismissing it accidentally is indistinguishable from choosing to stay — and
 * a learner who meant to leave will tap again.
 */

import { useEffect, useRef } from 'react'

import { CELL } from '../lib/reviewGrid'
import { formatDuration } from '../lib/examClock'
import { IconBolt, IconClock, IconFlag, IconWarn } from './QuizIcons'

/**
 * The sheet shell: scrim, grabber, focus trap, Escape.
 *
 * Focus moves INTO the sheet on open and back to the opener on close. Without
 * it a keyboard or screen-reader learner opens the review grid and their focus
 * is still behind it, on the runner they can no longer see.
 */
function Sheet({ title, onClose, dismissible = true, children }) {
  const ref = useRef(null)
  const returnFocusTo = useRef(null)

  useEffect(() => {
    returnFocusTo.current = document.activeElement
    const node = ref.current
    node?.querySelector('h2')?.focus?.()
    node?.focus?.()
    function onKey(e) {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const back = returnFocusTo.current
      if (back && typeof back.focus === 'function') back.focus()
    }
  }, [dismissible, onClose])

  return (
    <div
      className="pq-scrim"
      onClick={(e) => { if (dismissible && e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <div className="pq-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="pq-grabber" aria-hidden="true" />
        {children}
      </div>
    </div>
  )
}

/** §2 — every question as a cell. Tap to jump. */
export function ReviewGridSheet({ cells, summary, onJump, onClose, currentIndex }) {
  return (
    <Sheet title="Your paper" onClose={onClose}>
      <h2>Your paper</h2>
      <p className="pq-lede">Tap any question to jump to it.</p>
      <div className="pq-legend">
        <span><i className="pq-dot is-answered" />Answered</span>
        <span><i className="pq-dot is-blank" />Not answered</span>
        <span><i className="pq-dot is-flagged" />Flagged</span>
      </div>
      <div className="pq-grid">
        {cells.map((c) => (
          <button
            type="button"
            key={c.questionId}
            className={[
              'pq-cell',
              c.state === CELL.ANSWERED ? 'is-answered' : '',
              c.flagged ? 'is-flagged' : '',
              c.current ? 'is-current' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => onJump(c.index)}
            aria-label={`Question ${c.label}${c.state === CELL.ANSWERED ? ', answered' : ', not answered'}${c.flagged ? ', flagged' : ''}`}
            aria-current={c.current ? 'true' : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="pq-fineprint">
        {`${summary.answered} of ${summary.total} answered`}
        {summary.flagged > 0 ? ` · ${summary.flagged} flagged` : ''}
      </p>
      <button type="button" className="pq-cta is-secondary" onClick={onClose}>
        {`Back to question ${currentIndex + 1}`}
      </button>
    </Sheet>
  )
}

/**
 * §2 — the submit confirmation. Counts blanks and flags, states the time left,
 * and offers "go to the first blank one".
 *
 * The copy tells the truth: a guess costs you nothing. That line is not
 * encouragement, it is the actual scoring rule, and a learner who does not
 * know it leaves marks on the table out of caution.
 */
export function SubmitSheet({ summary, lines, secondsLeft, showClock, onGoToBlank, onSubmit, onClose, submitting }) {
  return (
    <Sheet title="Finish the exam?" onClose={onClose}>
      <h2>Finish the exam?</h2>
      <p className="pq-lede">
        Once you submit, your answers are marked and you will see everything you got right and wrong.
      </p>
      {lines.map((l) => (
        <div className={`pq-warn ${l.tone === 'warn' ? '' : ''}`} key={l.text}>
          {l.icon === 'flag' ? <IconFlag size={19} /> : <IconWarn size={19} />}
          <p>{l.text}</p>
        </div>
      ))}
      {showClock && (
        <div className="pq-warn">
          <IconClock size={19} />
          <p>{'You still have '}<b>{formatDuration(secondsLeft)}</b>{' left.'}</p>
        </div>
      )}
      {summary.firstBlankIndex != null && (
        <>
          <button type="button" className="pq-cta is-secondary" onClick={() => onGoToBlank(summary.firstBlankIndex)}>
            Go to the first blank one
          </button>
          <div className="pq-stack" />
        </>
      )}
      <button type="button" className="pq-cta" onClick={onSubmit} disabled={submitting}>
        {submitting ? 'Marking your paper…' : 'Submit my answers'}
      </button>
      <div className="pq-stack" />
      <button type="button" className="pq-cta is-quiet" onClick={onClose}>Keep working</button>
    </Sheet>
  )
}

/**
 * §2 — the exit sheet. Three ways out and no dead end.
 *
 * Not dismissible by scrim tap: an accidental dismissal is indistinguishable
 * from choosing to stay, and this is the one sheet where the wrong reading
 * costs a learner their paper.
 */
export function ExitSheet({ answered, total, onStay, onSwitchToPractice, onLeave, leaving }) {
  return (
    <Sheet title="Leave the exam?" onClose={onStay} dismissible={false}>
      <h2>Leave the exam?</h2>
      <p className="pq-lede">
        {'The clock is still running. If you leave now this attempt '}
        <b>will not be counted</b>
        {' — no score, nothing saved to your results.'}
      </p>
      <div className="pq-warn is-danger">
        <IconWarn size={19} />
        <p>
          {'You have answered '}
          <b>{`${answered} of ${total}`}</b>
          {' questions. All of it will be lost.'}
        </p>
      </div>
      <div className="pq-warn">
        <IconBolt size={19} />
        <p>
          {'Want to keep going but without the clock? '}
          <b>Practice mode</b>
          {' explains every answer as you go — but it does not count as an exam attempt.'}
        </p>
      </div>
      <button type="button" className="pq-cta is-secondary" onClick={onStay}>Stay in the exam</button>
      <div className="pq-stack" />
      <button type="button" className="pq-cta is-quiet" onClick={onSwitchToPractice}>
        Switch to practice instead
      </button>
      <div className="pq-stack" />
      <button type="button" className="pq-cta is-quiet is-danger" onClick={onLeave} disabled={leaving}>
        {leaving ? 'Leaving…' : "Leave — don't count this"}
      </button>
    </Sheet>
  )
}
