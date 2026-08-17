/**
 * LearnerHomePage — Home, in the mockup's order and with nothing the
 * mockup does not have:
 *
 *   topbar (logo · night · streak · bell · avatar)
 *   greeting + Grade · Term chip
 *   exam countdown card              → /timetable
 *   Continue where you left off
 *   Today's Quiz (slim daily card)
 *   Explore — Past Papers · Notes · Games · Timetable
 *   My subjects
 *
 * That list is the whole page. Earlier passes carried over sections from
 * the pre-redesign dashboard — a Past Papers hero, Today's Exams, a
 * Quick Access grid (which linked Lessons and Quizzes, neither of which
 * exists in the mockup), Recommended for You, Recent Activity and an
 * Achievements summary. None of them appear in prototype v3, v4, v5 or
 * v6, so they are gone rather than restyled. Achievements live on the
 * Games hub and Profile, where the mockup puts them.
 *
 * One view-model hook feeds every card; sections own their empty and
 * loading states.
 */
import { useEffect } from 'react'
import LearnerHeader from '../components/LearnerHeader'
import ExamCountdownCard from '../components/ExamCountdownCard'
import { ErrorState } from '../components/LearnerPrimitives'
import useLearnerDashboard from '../hooks/useLearnerDashboard'
import ContinueLearningCard from '../sections/ContinueLearningCard'
import { TodaysQuizCard, ExploreGrid, MySubjectsSection } from '../sections/HomeSections'
import { capture } from '../../../utils/analytics'

export default function LearnerHomePage() {
  const { loading, error, data, timetables, refresh } = useLearnerDashboard()

  useEffect(() => { capture('learner_dashboard_viewed') }, [])

  const activeTerm = data?.activeTerm?.term ?? null

  return (
    <>
      <LearnerHeader activeTerm={activeTerm} streak={data?.streak ?? null} />
      {error ? (
        <div className="lhx-card">
          <ErrorState onRetry={refresh}>
            We couldn’t load your dashboard. Check your connection and try again.
          </ErrorState>
        </div>
      ) : (
        <>
          <ExamCountdownCard timetables={timetables} />
          <ContinueLearningCard
            resume={data?.learningResume}
            activeTerm={activeTerm}
            loading={loading}
          />
          {!loading && <TodaysQuizCard challenge={data?.gameChallenge} streak={data?.streak || 0} />}
          <ExploreGrid />
          <MySubjectsSection subjects={data?.subjects} activeTerm={activeTerm} loading={loading} />
        </>
      )}
    </>
  )
}
