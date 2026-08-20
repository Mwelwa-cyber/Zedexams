/**
 * The spelling ladder, as a path.
 *
 * A path rather than a list, because a list of 100 stages is a wall and a path
 * is something a child can feel themselves climbing. Chapters group the stages
 * by WHAT MAKES THE WORDS HARD — double letters, silent letters, -ie/-ei,
 * suffix rules — which is how spelling is actually taught and is a real
 * difficulty ladder rather than an arbitrary ordering.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT HAVE, from the mock-up's own warning:
 * no lives, no energy meter, no wait-or-pay, no paid retries, nothing that can
 * stop a child practising. Every cleared stage stays open forever and replaying
 * one can only ever raise its rating.
 *
 * A LOCKED STAGE IS STILL DRAWN. Seeing what is coming is most of what makes a
 * ladder feel like one, and a locked chapter shows its name and its blurb so
 * the learner knows silent letters are next. It is not tappable, and it says
 * why rather than doing nothing when tapped.
 *
 * THE MAP IS VIRTUALISED BY CHAPTER, not by node. The ladder is ~100 stages;
 * rendering every node of every chapter puts several hundred elements on a
 * cheap phone for a screen where only one chapter matters. Chapters render
 * their nodes when they are the current one, adjacent to it, or opened by the
 * learner — see `openChapters`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { TRICKY_STAGE } from '../lib/spellingMapCore'

function Stars({ count, label }) {
  return (
    <span className="lhx-sp-stars" aria-label={label || `${count} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={i < count ? '' : 'is-off'} aria-hidden="true">★</span>
      ))}
    </span>
  )
}

export default function SpellingStageMap({
  map,
  grade,
  onPickStage,
  onPickTricky,
  onExit,
  synced = true,
}) {
  const { chapters, currentStage, currentChapter, totalStars } = map
  const [openChapters, setOpenChapters] = useState(() => new Set(currentChapter ? [currentChapter.id] : []))
  const currentRef = useRef(null)

  // Land the learner on the stage they are about to play, not at stage 1 —
  // by chapter 5 that is a long scroll to reach the only tappable node.
  useEffect(() => {
    // Feature-detected: `scrollIntoView` is absent in jsdom and in a handful
    // of older WebViews, and an unguarded call there throws during mount and
    // takes the whole map down rather than merely not scrolling.
    const node = currentRef.current
    if (typeof node?.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center', behavior: 'auto' })
    }
  }, [])

  const visible = useMemo(() => {
    const at = chapters.findIndex((c) => c.id === currentChapter?.id)
    return new Set(
      chapters
        .filter((c, i) => openChapters.has(c.id) || (at >= 0 && Math.abs(i - at) <= 1))
        .map((c) => c.id),
    )
  }, [chapters, currentChapter, openChapters])

  const toggle = (id) => {
    setOpenChapters((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="lhx-sp-map">
      <header className="lhx-sp-map-head">
        <button type="button" className="lhx-sp-back" onClick={onExit} aria-label="Back to games">‹</button>
        <h1 className="lhx-sp-map-title">Spelling</h1>
        <span className="lhx-sp-starchip" aria-label={`${totalStars} stars earned`}>⭐ {totalStars}</span>
      </header>

      {!synced && (
        // Said plainly rather than implied. A learner whose record has not
        // reached the server is still playing on a real record — it is the
        // one on this device — and the honest line is which one it is.
        <p className="lhx-sp-offline" role="status">
          Playing offline — your progress is saved on this device and will sync when you are back online.
        </p>
      )}

      {!chapters.length && (
        <p className="lhx-sp-empty">
          No spelling words are ready for Grade {grade} yet. Check back soon.
        </p>
      )}

      <div className="lhx-sp-path">
        {chapters.map((chapter) => {
          const open = visible.has(chapter.id)
          return (
            <section key={chapter.id} className={`lhx-sp-chapter ${chapter.locked ? 'is-locked' : ''}`}>
              <button
                type="button"
                className="lhx-sp-chapter-head"
                onClick={() => toggle(chapter.id)}
                aria-expanded={open}
              >
                <span className="lhx-sp-chapter-n">
                  Chapter {chapter.index} of {chapter.total} · Grade {grade}
                  {chapter.locked ? ' · locked' : ''}
                </span>
                <span className="lhx-sp-chapter-t">{chapter.title}</span>
                <span className="lhx-sp-chapter-d">{chapter.blurb}</span>
                {!chapter.locked && (
                  <span className="lhx-sp-chapter-bar" aria-label={`${chapter.progressPct}% of this chapter cleared`}>
                    <i style={{ width: `${chapter.progressPct}%` }} />
                  </span>
                )}
              </button>

              {open && (
                <ol className="lhx-sp-nodes">
                  {chapter.nodes.map((node, i) => {
                    if (node.kind === 'tricky') {
                      return (
                        <li key={node.id} className={`lhx-sp-node ${i % 2 ? 'is-left' : 'is-right'}`}>
                          <button
                            type="button"
                            className="lhx-sp-circ is-special"
                            onClick={onPickTricky}
                            aria-label={`Your tricky words — ${node.words} words you keep missing`}
                          >
                            📌
                          </button>
                          <span className="lhx-sp-node-lab">Tricky words</span>
                        </li>
                      )
                    }
                    const locked = node.state === 'locked'
                    return (
                      <li key={node.id} className={`lhx-sp-node ${i % 2 ? 'is-left' : 'is-right'}`}>
                        <button
                          type="button"
                          ref={node.stage === currentStage ? currentRef : null}
                          className={`lhx-sp-circ is-${node.state}`}
                          disabled={locked}
                          aria-label={
                            locked
                              ? `Stage ${node.stage}, locked. Clear stage ${node.stage - 1} first.`
                              : node.state === 'current'
                                ? `Stage ${node.stage}, play now`
                                : `Stage ${node.stage}, cleared with ${node.stars} of 3 stars. Play again.`
                          }
                          onClick={() => !locked && onPickStage(node.stage, chapter)}
                        >
                          {node.stage}
                        </button>
                        {node.stars > 0 && <Stars count={node.stars} />}
                        {node.state === 'current' && <span className="lhx-sp-node-lab">Play now</span>}
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The stage-introduction sheet — what a learner sees between tapping a node
 * and starting.
 *
 * It exists to answer one question before the round begins: what am I about to
 * get? Eight words, six new, two you have seen before — and, when the learner's
 * own missed words are in the set, it SAYS SO by name. That line is the answer
 * to "the same six words again": two children on stage 24 genuinely do not get
 * the same words, and this is where they find that out.
 *
 * IT NEVER SHOWS AN ANSWER. The returning words are named because the learner
 * has already met them and knowing they are coming is the point of spaced
 * practice; the six new ones are not, and neither is any spelling on this
 * screen shown next to what it will be tested as.
 */
export function StageIntroSheet({
  stage,
  chapter,
  words = [],
  fromPool = [],
  resume = null,
  onStart,
  onResume,
  onReplayPrevious,
  onClose,
}) {
  const returning = fromPool.length
  const fresh = Math.max(0, words.length - returning)

  return (
    <div className="lhx-sp-sheet-wrap" role="dialog" aria-modal="true" aria-label={`Stage ${stage}`}>
      <button type="button" className="lhx-sp-scrim" onClick={onClose} aria-label="Close" />
      <div className="lhx-sp-sheet">
        <span className="lhx-sp-grab" aria-hidden="true" />
        <h2 className="lhx-sp-sheet-title">
          {stage === TRICKY_STAGE ? 'Your tricky words' : `Stage ${stage}`}
        </h2>
        <p className="lhx-sp-sheet-sub">
          {chapter ? `${chapter.title} · Chapter ${chapter.index}` : 'The words you keep missing'}
        </p>

        <div className="lhx-sp-sheet-stats">
          <div><b>{words.length}</b><span>words</span></div>
          <div><b>{fresh}</b><span>new</span></div>
          <div><b>{returning}</b><span>from before</span></div>
        </div>

        {returning > 0 && (
          <p className="lhx-sp-sheet-tricky">
            <b>📌 {returning === 1 ? 'One of your tricky words is back' : `${returning} of your tricky words are back`}</b>
            You missed {fromPool.slice(0, 3).map((w) => String(w).toLowerCase()).join(', ')}
            {fromPool.length > 3 ? ' and others' : ''} before. They are mixed in with the new ones —
            get them right in a few more sessions and they are yours.
          </p>
        )}

        {resume && (
          <button type="button" className="lhx-sp-cta" onClick={onResume}>
            Carry on — {resume.words.length - resume.index} words left
          </button>
        )}

        <button type="button" className={resume ? 'lhx-sp-ghost lhx-sp-wide' : 'lhx-sp-cta'} onClick={onStart}>
          {resume ? 'Start again from the beginning' : stage === TRICKY_STAGE ? 'Take them on' : `Start stage ${stage}`}
        </button>

        {onReplayPrevious && (
          <button type="button" className="lhx-sp-ghost lhx-sp-wide" onClick={onReplayPrevious}>
            Practise stage {Number(stage) - 1} again
          </button>
        )}
      </div>
    </div>
  )
}
