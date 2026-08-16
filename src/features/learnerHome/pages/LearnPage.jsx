/**
 * LearnPage — the Learn tab: every subject for the learner's grade with
 * current-term progress, plus direct doors into the Lessons and Notes
 * libraries. Quick Access deep-links land here with ?tab=lessons|notes
 * and are forwarded to the existing library routes (preserved intact).
 */
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import LearnerHeader from '../components/LearnerHeader'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { ProgressBar, ErrorState, SectionSkeleton, EmptyState } from '../components/LearnerPrimitives'
import useLearnerDashboard from '../hooks/useLearnerDashboard'
import { capture } from '../../../utils/analytics'

const TINTS = ['lhx-tint-green', 'lhx-tint-blue', 'lhx-tint-pink', 'lhx-tint-orange', 'lhx-tint-purple']

export default function LearnPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { loading, error, data, refresh } = useLearnerDashboard()

  // Quick Access lands on ?tab=lessons / ?tab=notes → forward to the
  // existing libraries so those routes stay the single source of truth.
  const tab = params.get('tab')
  useEffect(() => {
    if (tab === 'lessons') navigate('/lessons', { replace: true })
    if (tab === 'notes') navigate('/notes', { replace: true })
  }, [tab, navigate])

  const activeTerm = data?.activeTerm?.term ?? null
  const subjects = data?.subjects || []

  return (
    <>
      <LearnerHeader showGreeting={false} />
      <div>
        <h1 className="lhx-page-title">Learn</h1>
        <p className="lhx-page-sub">Lessons, notes and topics for your grade{activeTerm ? ` · Term ${activeTerm}` : ''}</p>
      </div>

      <div className="lhx-quick" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <button type="button" className="lhx-quick-card lhx-press" aria-label="Open lessons library" onClick={() => navigate('/lessons')}>
          <span className="lhx-quick-icon lhx-tint-purple" aria-hidden="true"><LearnerIcon name="lessons" size={22} /></span>
          <span className="lhx-quick-title">Lessons</span>
          <span className="lhx-quick-label">{data?.lessonsCount ? `${data.lessonsCount} available` : 'Library'}</span>
        </button>
        <button type="button" className="lhx-quick-card lhx-press" aria-label="Open notes library" onClick={() => navigate('/notes')}>
          <span className="lhx-quick-icon lhx-tint-green" aria-hidden="true"><LearnerIcon name="notes" size={22} /></span>
          <span className="lhx-quick-title">Notes</span>
          <span className="lhx-quick-label">{data?.notesCount ? `${data.notesCount} available` : 'Library'}</span>
        </button>
      </div>

      <section className="lhx-section" aria-labelledby="lhx-learn-subjects">
        <div className="lhx-section-head">
          <h2 id="lhx-learn-subjects" className="lhx-section-title">My Subjects</h2>
        </div>
        {error ? (
          <div className="lhx-card"><ErrorState onRetry={refresh} /></div>
        ) : loading ? (
          <SectionSkeleton lines={6} height={56} />
        ) : subjects.length === 0 ? (
          <div className="lhx-card"><EmptyState icon="learn">Your subjects will appear here once your grade is set.</EmptyState></div>
        ) : (
          <div className="lhx-subjects">
            {subjects.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className="lhx-subject-row lhx-press"
                onClick={() => {
                  capture('subject_opened', { subject: s.id, from: 'learn' })
                  navigate(`/subjects/${s.id}`)
                }}
              >
                <span className={`lhx-subject-icon ${TINTS[i % TINTS.length]}`} aria-hidden="true">
                  <LearnerIcon name={subjectIconName(s.id)} size={22} />
                </span>
                <span className="lhx-subject-main">
                  <span className="lhx-subject-name">{s.label}</span>
                  <span className="lhx-subject-meta" style={{ display: 'block' }}>
                    {[activeTerm ? `Term ${activeTerm}` : null, s.topicCount ? `${s.topicCount} topics` : null].filter(Boolean).join(' · ')}
                  </span>
                  <ProgressBar percent={s.percent} label={`${s.label}: ${s.percent}% complete`} />
                </span>
                <span className="lhx-subject-pct">{s.percent}%</span>
                <ChevronRight size={18} className="lhx-chevron" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
