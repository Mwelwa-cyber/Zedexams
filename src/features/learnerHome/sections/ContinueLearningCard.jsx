/**
 * ContinueLearningCard — the prototype's indigo `.continue-card`: the
 * sun-flare gradient, the floating 🎒/✨, the "CONTINUE WHERE YOU LEFT
 * OFF" label, the topic, its subject · term line, a gold progress bar
 * and one coral "Continue learning" button.
 *
 * One intelligent resume drives it (pickLearningResume: in-progress
 * quiz → in-progress/recent notes → next current-term material).
 * Hidden values are never faked: with no signal the card invites the
 * learner to pick a subject from the list below rather than inventing
 * a topic to resume.
 *
 * The second "Open Notes" button the old card carried is gone — the
 * mockup's card has exactly one action, and Notes is a tab plus an
 * Explore tile, so nothing became unreachable.
 */
import { useNavigate } from 'react-router-dom'
import { EmptyState, SectionSkeleton } from '../components/LearnerPrimitives'
import { capture } from '../../../utils/analytics'

export default function ContinueLearningCard({ resume, activeTerm, loading }) {
  const navigate = useNavigate()

  if (loading) {
    return (
      <section className="lhx-card lhx-continue" aria-label="Continue learning">
        <SectionSkeleton lines={3} />
      </section>
    )
  }

  if (!resume) {
    // No button here since step 5: the Learn tab is retired and the full
    // subjects list now renders right below this card on Home.
    return (
      <section className="lhx-card lhx-continue" aria-labelledby="lhx-continue-title">
        <p id="lhx-continue-title" className="lhx-kicker">Continue learning</p>
        <EmptyState icon="learn">
          Choose a subject below to begin learning.
        </EmptyState>
      </section>
    )
  }

  const target = resume.kind === 'quiz'
    ? `/quiz/${resume.id}`
    : resume.kind === 'lesson'
      ? `/lessons/${resume.id}`
      : `/notes/${resume.id}`
  const go = () => {
    capture('lesson_resumed', { kind: resume.kind, id: resume.id })
    navigate(target)
  }

  const metaLine = [resume.subjectLabel, activeTerm ? `Term ${activeTerm}` : null].filter(Boolean).join(' · ')
  const percent = Math.max(0, Math.min(100, Math.round(Number(resume.percent) || 0)))

  return (
    <section className="lhx-continue-hero" aria-labelledby="lhx-continue-title">
      <span className="lhx-cc-emoji" aria-hidden="true">🎒</span>
      <span className="lhx-cc-emoji2" aria-hidden="true">✨</span>
      <p id="lhx-continue-title" className="lhx-cc-label">CONTINUE WHERE YOU LEFT OFF</p>
      <p className="lhx-cc-title">{resume.title}</p>
      {(metaLine || resume.detail) && (
        <p className="lhx-cc-sub">{[metaLine, resume.detail].filter(Boolean).join(' · ')}</p>
      )}
      {/* The bar is drawn only when there is real progress to draw — a
          0% bar on a not-yet-started topic reads as a stalled one. */}
      {percent > 0 && (
        <div
          className="lhx-cc-progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${resume.title}: ${percent}% complete`}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
      )}
      <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={go}>
        ▶&nbsp; {resume.kind === 'quiz' ? 'Continue quiz' : 'Continue learning'}
      </button>
    </section>
  )
}
