/**
 * LearnerHomePage — the prototype's Home, in its order and with only
 * its blocks: the exam countdown card, Continue where you left off,
 * Today's Quiz, Explore (Papers · Notes · Games — one horizontal row at
 * every width), then My subjects.
 *
 * The Past Papers hero, Today's Exams panel, Recommended, the Daily
 * Game Challenge, Recent Activity and the Achievements summary left
 * with this step — the mockup's Home is five blocks, and each of those
 * surfaces has a home of its own (Explore tiles, /my-results,
 * /profile, the games hub). One view-model hook still feeds every
 * card; sections own their empty/loading states.
 */
import { useEffect } from 'react'
import LearnerHeader from '../components/LearnerHeader'
import ExamCountdownCard from '../components/ExamCountdownCard'
import { ErrorState } from '../components/LearnerPrimitives'
import useLearnerDashboard from '../hooks/useLearnerDashboard'
import ContinueLearningCard from '../sections/ContinueLearningCard'
import TodaysQuizCard from '../sections/TodaysQuizCard'
import { ExploreGrid, MySubjectsSection } from '../sections/HomeSections'
import { capture } from '../../../utils/analytics'

export default function LearnerHomePage() {
  const { loading, error, data, timetables, refresh } = useLearnerDashboard()

  useEffect(() => { capture('learner_dashboard_viewed') }, [])

  const activeTerm = data?.activeTerm?.term ?? null

  return (
    <>
      {/* The chip states the calendar's answer and opens the School
          Calendar; `activeTerm` rides along as the fallback for dates the
          calendar holds no data for. */}
      <LearnerHeader activeTerm={activeTerm} calendar={data?.calendar ?? null} streak={data?.streak ?? null} />
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
          {/* Fetches its own state from the one daily-quiz read path — it is
              not part of the dashboard view-model, and it renders at every
              stage rather than waiting for the dashboard to finish. */}
          <TodaysQuizCard />
          <ExploreGrid />
          <MySubjectsSection subjects={data?.subjects} activeTerm={activeTerm} loading={loading} />
        </>
      )}
    </>
  )
}
