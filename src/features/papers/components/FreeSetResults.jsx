/**
 * FreeSetResults — where the in-paper lock actually lives.
 *
 * The learner has just answered the last question of the free set. Completing
 * it did exactly what completing the last question of any quiz does: it
 * navigated here. Nothing rendered at the boundary — no modal, no sheet, no
 * toast, no banner. `PublicQuizRunner` declares `quiz_active` for its whole
 * run, so even a surface that forgot to ask would have been refused.
 *
 * ── Order on screen, and why it is this order ──────────────────────────
 *
 *   1. Score ring          — the thing they earned
 *   2. Section label       — "Section A, Part 1 done", a unit they completed
 *   3. Review the ones they got wrong — FREE, prominent, correct answers and
 *      explanations. This is the single most important element on the screen.
 *   4. Weak-topic callout  — also free
 *   5. PaperContinueLock   — the offer, last, inline, dismissible
 *
 * Marking and review of questions ALREADY ANSWERED are free on every plan,
 * permanently. Putting `AUTO_MARKING` in front of this screen would earn one
 * refusal and cost the habit — the review is the reason the learner opens the
 * app tomorrow. `FreeSetResults.spec.jsx` asserts the review is reachable and
 * unblurred on `plan: 'free'`, and it is there to fail loudly if a later
 * change decides feedback is a premium feature.
 */

import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import PaperContinueLock from './PaperContinueLock'
import { capture } from '../../../utils/analytics'

function ScoreRing({ score, outOf }) {
  const pct = outOf > 0 ? Math.round((score / outOf) * 100) : 0
  return (
    <div
      className="relative mx-auto grid h-20 w-20 place-items-center rounded-full"
      style={{ background: `conic-gradient(var(--tw-ring-color, #12A594) 0 ${pct}%, rgba(120,120,150,.18) ${pct}% 100%)` }}
      role="img"
      aria-label={`You scored ${score} out of ${outOf}`}
    >
      <span className="absolute inset-[7px] rounded-full theme-card" aria-hidden="true" />
      <span className="relative z-10 text-center leading-none">
        <span className="block font-display text-2xl font-black theme-text">{score}</span>
        <span className="block text-[9px] font-black theme-text-muted">OF {outOf}</span>
      </span>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object} props.paper
 * @param {object} props.freeSet          from resolveFreeSet()
 * @param {number} props.score
 * @param {number} props.outOf
 * @param {number} props.wrongCount
 * @param {{topic:string, detail:string}|null} [props.weakTopic]
 * @param {() => void} props.onReview     opens the per-question review
 * @param {() => void} [props.onDismissLock]
 * @param {boolean} [props.unlocked]      a paid learner sees no lock at all
 */
export default function FreeSetResults({
  paper,
  freeSet,
  score,
  outOf,
  wrongCount,
  weakTopic = null,
  onReview,
  onDismissLock,
  unlocked = false,
}) {
  useEffect(() => {
    capture('free_set_completed', {
      paper_id: paper?.id || null,
      score,
      out_of: outOf,
      weak_topic: weakTopic?.topic || null,
    })
  }, [paper?.id, score, outOf, weakTopic?.topic])

  const showLock = !unlocked && freeSet?.remaining > 0

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <div className="theme-card rounded-radius-md border theme-border p-5 text-center shadow-elev-sm">
        <ScoreRing score={score} outOf={outOf} />

        <h1 className="mt-3 font-display text-lg font-black theme-text">
          {freeSet?.sectionLabel ? `${freeSet.sectionLabel} done` : 'Practice complete'}
        </h1>
        {freeSet?.sectionTitle && (
          <p className="mt-0.5 text-[12px] theme-text-muted">{freeSet.sectionTitle}</p>
        )}

        {/* FREE, on every plan, permanently. Never gate this. */}
        {wrongCount > 0 && (
          <button
            type="button"
            onClick={() => {
              capture('results_review_opened', { paper_id: paper?.id || null, wrong_count: wrongCount })
              onReview?.()
            }}
            className="mt-3 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] font-black text-indigo-700 shadow-none hover:bg-indigo-100 dark:border-indigo-400/30 dark:bg-indigo-500/15 dark:text-indigo-200"
          >
            Review the {wrongCount} you got wrong →
          </button>
        )}

        {weakTopic?.topic && (
          <div className="mt-2 flex items-start gap-2 rounded-radius-md border border-amber-200 bg-amber-50 p-2.5 text-left dark:border-amber-400/30 dark:bg-amber-500/10">
            <span className="text-sm" aria-hidden="true">📌</span>
            <span>
              <span className="block text-[12px] font-black text-amber-900 dark:text-amber-200">
                Work on: {weakTopic.topic}
              </span>
              {weakTopic.detail && (
                <span className="block text-[11px] leading-snug text-amber-800/90 dark:text-amber-200/80">
                  {weakTopic.detail}
                </span>
              )}
            </span>
          </div>
        )}

        {showLock && (
          <PaperContinueLock
            paperId={paper?.id}
            remaining={freeSet.remaining}
            lockedTopics={freeSet.lockedSectionTitles}
            paperYear={paper?.year ? String(paper.year) : ''}
            onDismiss={onDismissLock}
          />
        )}

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link
            to="/papers"
            className="rounded-full border-2 theme-border theme-card px-4 py-1.5 text-[12px] font-black theme-text hover:theme-bg-subtle"
          >
            More past papers
          </Link>
        </div>
      </div>
    </div>
  )
}
