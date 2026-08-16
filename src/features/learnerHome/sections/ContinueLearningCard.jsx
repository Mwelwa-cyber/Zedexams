/**
 * ContinueLearningCard — one intelligent resume card driven by
 * pickLearningResume (in-progress quiz → in-progress/recent notes →
 * next current-term material). Hidden values are never faked: with no
 * signal the card invites the learner to pick a subject.
 */
import { useNavigate } from 'react-router-dom'
import { Play } from 'lucide-react'
import LearnerIcon from '../components/LearnerIcon'
import { ProgressBar, EmptyState, SectionSkeleton } from '../components/LearnerPrimitives'
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
        <p id="lhx-continue-title" className="lhx-kicker">Continue Learning</p>
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
  const openNotes = () => {
    capture('notes_opened', { from: 'continue_learning' })
    navigate(resume.kind === 'note' ? `/notes/${resume.id}` : (resume.subject ? `/notes?subject=${resume.subject}` : '/notes'))
  }

  const metaLine = [resume.subjectLabel, activeTerm ? `Term ${activeTerm}` : null].filter(Boolean).join(' · ')
  const percent = Math.max(0, Math.min(100, Math.round(Number(resume.percent) || 0)))

  return (
    <section className="lhx-card lhx-continue" aria-labelledby="lhx-continue-title">
      <div className="lhx-continue-head">
        <div style={{ minWidth: 0 }}>
          <p id="lhx-continue-title" className="lhx-kicker">Continue Learning</p>
          {metaLine && <p className="lhx-continue-subject">{metaLine}</p>}
          <p className="lhx-continue-topic">{resume.title}</p>
          {resume.detail && <p className="lhx-continue-meta">{resume.detail}</p>}
        </div>
        <span className="lhx-quick-icon lhx-tint-green" aria-hidden="true">
          <LearnerIcon name={resume.kind === 'quiz' ? 'quiz' : resume.kind === 'lesson' ? 'lessons' : 'notes'} size={22} />
        </span>
      </div>
      {percent > 0 && (
        <div className="lhx-continue-progress">
          <ProgressBar percent={percent} label={`${resume.title}: ${percent}% complete`} />
          <span className="lhx-continue-pct">{percent}%</span>
        </div>
      )}
      <div className="lhx-continue-actions">
        <button type="button" className="lhx-btn lhx-btn-green" onClick={go}>
          <Play size={18} aria-hidden="true" />
          {resume.kind === 'quiz' ? 'Continue Quiz' : resume.kind === 'lesson' ? 'Continue Lesson' : 'Continue Notes'}
        </button>
        <button type="button" className="lhx-btn lhx-btn-ghost" style={{ color: 'var(--lhx-green-deep)' }} onClick={openNotes}>
          <LearnerIcon name="notes" size={18} />
          Open Notes
        </button>
      </div>
    </section>
  )
}
