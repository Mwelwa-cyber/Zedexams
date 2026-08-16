/**
 * PracticePage — the Practice tab: Today's Daily Exams (permanent home,
 * spec §11), topic quizzes, revision, previous results. Uses its own
 * light data load (exams + locks only) instead of the full dashboard
 * view model, so opening Practice costs one query + the lock reads.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import LearnerHeader from '../components/LearnerHeader'
import LearnerIcon from '../components/LearnerIcon'
import { SectionSkeleton, ErrorState } from '../components/LearnerPrimitives'
import TodaysExamsCard from '../sections/TodaysExamsCard'
import { useAuth } from '../../../contexts/AuthContext'
import { getTodaysExamsBySubject, checkTodaysLocks } from '../../../utils/examService'

const PRACTICE_LINKS = [
  { icon: 'quiz', title: 'Topic Quizzes', sub: 'Practise any topic in your grade', to: '/quizzes', tint: 'lhx-tint-blue' },
  { icon: 'practice', title: 'Revision Quizzes', sub: 'Mixed revision for your grade', to: '/quizzes', tint: 'lhx-tint-purple' },
  { icon: 'daily-exam', title: 'Daily Exams', sub: 'One timed exam per subject each day', to: '/exams', tint: 'lhx-tint-green' },
  { icon: 'trophy', title: 'Leaderboard', sub: 'See today’s top performers', to: '/exams/leaderboard', tint: 'lhx-tint-orange' },
  { icon: 'progress', title: 'Previous Results', sub: 'Every quiz and exam you’ve completed', to: '/my-results', tint: 'lhx-tint-pink' },
]

export default function PracticePage() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const [state, setState] = useState({ loading: true, error: null, exams: [], locks: {} })

  const uid = currentUser?.uid
  const grade = userProfile?.grade ? String(userProfile.grade) : null

  useEffect(() => {
    if (!uid || !grade) { setState({ loading: false, error: null, exams: [], locks: {} }); return undefined }
    let stale = false
    Promise.all([
      getTodaysExamsBySubject(grade).catch(() => []),
      checkTodaysLocks(uid).catch(() => ({})),
    ]).then(([exams, locks]) => {
      if (!stale) setState({ loading: false, error: null, exams, locks })
    }).catch((error) => {
      if (!stale) setState({ loading: false, error, exams: [], locks: {} })
    })
    return () => { stale = true }
  }, [uid, grade])

  const hasExamsToday = state.exams.length > 0

  return (
    <>
      <LearnerHeader showGreeting={false} />
      <div>
        <h1 className="lhx-page-title">Practice</h1>
        <p className="lhx-page-sub">Daily exams, quizzes and revision</p>
      </div>

      {state.loading ? (
        <div className="lhx-card"><SectionSkeleton lines={3} /></div>
      ) : state.error ? (
        <div className="lhx-card"><ErrorState /></div>
      ) : hasExamsToday ? (
        <TodaysExamsCard todaysExams={{ exams: state.exams, locks: state.locks }} streak={0} />
      ) : (
        <div className="lhx-card">
          <p className="lhx-kicker">Daily Exams</p>
          <p className="lhx-page-sub" style={{ marginTop: 6 }}>
            No Daily Exam is open right now. The next Daily Exam opens tomorrow.
          </p>
        </div>
      )}

      <section className="lhx-section" aria-label="Practice options">
        <div className="lhx-list-rows">
          {PRACTICE_LINKS.map((item) => (
            <button key={item.title} type="button" className="lhx-list-row lhx-press" onClick={() => navigate(item.to)}>
              <span className={`lhx-quick-icon ${item.tint}`} aria-hidden="true">
                <LearnerIcon name={item.icon} size={22} />
              </span>
              <span className="lhx-activity-main">
                <span className="lhx-resource-title" style={{ display: 'block' }}>{item.title}</span>
                <span className="lhx-resource-sub" style={{ display: 'block' }}>{item.sub}</span>
              </span>
              <ChevronRight size={18} className="lhx-chevron" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </>
  )
}
