/**
 * The "break it up" coach — the remediation flow, in the mock-up's three
 * phases.
 *
 *   A. SHOW THE CUT. The word in the chunks a speller actually holds in their
 *      head, the trap marked, a line saying why people get it wrong, and a
 *      memory hook when a true one exists. Each chunk is tappable and says
 *      itself, because hearing "sep · a · rate" is half the lesson.
 *
 *   B. REBUILD IT. The same chunks, SHUFFLED, tapped back into order. This is
 *      the phase that teaches: the reveal alone teaches almost nothing, and
 *      scaffolded reconstruction while the shape is fresh is what sticks. A
 *      wrong choice shakes and is REFUSED — it does not delete correct
 *      progress, the option stays on screen, and the learner tries again.
 *      There is no way to fail this screen.
 *
 *   C. TRANSFER. Two or three words the SAME cut solves, which turns one word
 *      into a rule. Shown only when the content authored them; nothing is
 *      generated, because an invented "these all work the same way" is a
 *      linguistic claim and a wrong one teaches a pattern that does not exist.
 *
 * And then the word goes back into the round with none of it — no chunks, no
 * trap, no hook, no answer. `onDone` and `onSkip` are the same journey out;
 * the only difference is what gets recorded about how the learner got there.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { rebuildOptions, tapChunk } from '../lib/spellingCoachCore'
import { speakChunk, speakWord } from '../lib/spellingSpeech'
import { renderInlineMarkup } from '../lib/spellingContentCore'

export default function BreakItUpCoach({ coach, attempt = '', onDone, onSkip }) {
  const [phase, setPhase] = useState('cut')      // 'cut' | 'rebuild' | 'transfer'
  const [placed, setPlaced] = useState([])
  const [shake, setShake] = useState(-1)
  const timeouts = useRef([])
  useEffect(() => () => timeouts.current.forEach(clearTimeout), [])

  /**
   * The shuffle is computed ONCE for this episode. Recomputing it on each
   * render would re-deal the options under the learner's finger every time
   * they tapped one.
   */
  const options = useMemo(() => rebuildOptions(coach.chunks), [coach])

  if (!coach) return null

  const done = placed.length >= coach.chunks.length

  const tap = (option) => {
    const next = tapChunk(placed, option.index, coach.chunks.length)
    if (!next.accepted) {
      // Refused, not punished. Nothing is removed and the option stays
      // available — the shake is the whole of the feedback.
      setShake(option.index)
      timeouts.current.push(setTimeout(() => setShake(-1), 450))
      return
    }
    setPlaced(next.placed)
    speakChunk(option.chunk)
    if (next.done) {
      timeouts.current.push(setTimeout(() => setPhase('transfer'), 700))
    }
  }

  return (
    <div className="lhx-sp-coach">
      <header className="lhx-sp-coach-head">
        <h2 className="lhx-sp-coach-title">Let&apos;s fix this one</h2>
        <button type="button" className="lhx-sp-coach-close" onClick={onSkip} aria-label="Close and carry on">✕</button>
      </header>

      {/* ── A. Show the cut ─────────────────────────────────────── */}
      {phase === 'cut' && (
        <div className="lhx-sp-coach-body">
          {attempt && (
            <p className="lhx-sp-coach-miss">
              You wrote <b>{attempt}</b> — it is <b>{coach.word}</b>
            </p>
          )}

          <section className="lhx-sp-coach-card">
            <p className="lhx-sp-coach-kicker">{coach.label}</p>
            <p className="lhx-sp-coach-blurb">{coach.blurb}</p>

            <div className="lhx-sp-chunks">
              {coach.chunks.map((chunk, i) => (
                <button
                  key={`${chunk}-${i}`}
                  type="button"
                  className={`lhx-sp-chunk ${coach.trap === i ? 'is-trap' : ''}`}
                  onClick={() => speakChunk(chunk)}
                  aria-label={coach.trap === i ? `${chunk}, the tricky bit. Tap to hear it.` : `${chunk}. Tap to hear it.`}
                >
                  <span className="lhx-sp-chunk-n" aria-hidden="true">{i + 1}</span>
                  {chunk}
                </button>
              ))}
            </div>
            <p className="lhx-sp-coach-hint">Tap each piece to hear it</p>

            {/* A hook is rare on purpose — 78 of 79 authored words have none,
                and an invented one is worse than nothing. It renders only
                when the content carried both the hook and the note that says
                what it means. */}
            {coach.hook && (
              <div className="lhx-sp-hook">
                {/* The hook's emphasis IS the teaching — "there's <u>a rat</u>
                    in sepa<u>rat</u>e" — so it cannot be flattened to plain
                    text. `renderInlineMarkup` whitelists the four inline tags
                    and ESCAPES everything else, which is what makes an admin
                    -authored string safe to render this way. */}
                <p className="lhx-sp-hook-line">
                  💡 <span dangerouslySetInnerHTML={{ __html: renderInlineMarkup(coach.hook) }} />
                </p>
                <p className="lhx-sp-hook-note" dangerouslySetInnerHTML={{ __html: renderInlineMarkup(coach.hookNote) }} />
              </div>
            )}

            {coach.why && (
              <div className="lhx-sp-why">
                <p className="lhx-sp-why-title">Why people get it wrong</p>
                <p className="lhx-sp-why-body" dangerouslySetInnerHTML={{ __html: renderInlineMarkup(coach.why) }} />
              </div>
            )}
          </section>

          <button type="button" className="lhx-sp-cta" onClick={() => setPhase('rebuild')}>
            Now you build it →
          </button>
          <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onSkip}>
            Skip — I&apos;ve got it
          </button>
        </div>
      )}

      {/* ── B. Rebuild it ───────────────────────────────────────── */}
      {phase === 'rebuild' && (
        <div className="lhx-sp-coach-body">
          <section className="lhx-sp-coach-card">
            <p className="lhx-sp-coach-kicker">Put it back together</p>

            <div className="lhx-sp-rebuild" aria-live="polite">
              {coach.chunks.map((chunk, i) => (
                <span key={i} className={`lhx-sp-rslot ${placed.length > i ? 'is-filled' : ''}`}>
                  {placed.length > i ? coach.chunks[placed[i]] : ''}
                </span>
              ))}
            </div>

            {!done && (
              <p className="lhx-sp-coach-prompt">
                Which piece comes <b>{['first', 'second', 'third', 'fourth', 'fifth'][placed.length] || 'next'}</b>?
              </p>
            )}

            <div className="lhx-sp-options">
              {options.map((option) => {
                const used = placed.includes(option.index)
                return (
                  <button
                    key={option.index}
                    type="button"
                    className={`lhx-sp-option ${used ? 'is-used' : ''} ${shake === option.index ? 'is-shake' : ''}`}
                    disabled={used}
                    aria-label={used ? `${option.chunk}, placed` : `Place ${option.chunk}`}
                    onClick={() => tap(option)}
                  >
                    {option.chunk}
                  </button>
                )
              })}
            </div>

            <p className="lhx-sp-coach-hint">No rush. Pick the pieces in the right order.</p>
          </section>

          <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onSkip}>
            Skip — I&apos;ve got it
          </button>
        </div>
      )}

      {/* ── C. Transfer ─────────────────────────────────────────── */}
      {phase === 'transfer' && (
        <div className="lhx-sp-coach-body">
          <div className="lhx-sp-coach-done">
            <span className="lhx-sp-tick" aria-hidden="true">✓</span>
            <p className="lhx-sp-built">{coach.chunks.join('·')}</p>
            <p className="lhx-sp-built-title">You built it</p>
            <p className="lhx-sp-built-note">
              <b>{coach.word}</b> goes on your tricky words. It comes back on its own — no help next time.
            </p>
            <button type="button" className="lhx-sp-hear-small" onClick={() => speakWord(coach.word)}>
              🔊 Hear the whole word
            </button>
          </div>

          {coach.related.length > 0 && (
            <section className="lhx-sp-transfer">
              <p className="lhx-sp-transfer-title">The same cut works on these</p>
              <div className="lhx-sp-transfer-words">
                {coach.related.map((word) => (
                  <button
                    key={word}
                    type="button"
                    className="lhx-sp-transfer-word"
                    onClick={() => speakWord(word)}
                    aria-label={`${word}. Tap to hear it.`}
                  >
                    {word}
                  </button>
                ))}
              </div>
              <p className="lhx-sp-transfer-note">Learn the pattern once and it carries all of them.</p>
            </section>
          )}

          <button type="button" className="lhx-sp-cta" onClick={onDone}>Back to the round →</button>
        </div>
      )}
    </div>
  )
}
