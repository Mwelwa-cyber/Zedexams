/**
 * LearnerHomePage — the learner dashboard, in the approved section
 * order: Past Papers hero → Continue Learning → Today's Exams (when
 * relevant) → Quick Access → My Subjects → Exam Timetable + countdown →
 * Recommended → Daily Game Challenge → Recent Activity → Achievements.
 * One view-model hook feeds every card; sections own their empty/
 * loading states.
 */
import { useEffect } from 'react'
import LearnerHeader from '../components/LearnerHeader'
import { ErrorState } from '../components/LearnerPrimitives'
import useLearnerDashboard from '../hooks/useLearnerDashboard'
import PastPapersHero from '../sections/PastPapersHero'
import ContinueLearningCard from '../sections/ContinueLearningCard'
import TodaysExamsCard from '../sections/TodaysExamsCard'
import {
  QuickAccessGrid,
  MySubjectsSection,
  RecommendationsSection,
  DailyGameChallengeCard,
  RecentActivitySection,
  AchievementsSummary,
} from '../sections/HomeSections'
import { capture } from '../../../utils/analytics'

export default function LearnerHomePage() {
  const { loading, error, data, grade, timetables, refresh } = useLearnerDashboard()

  useEffect(() => { capture('learner_dashboard_viewed') }, [])

  const activeTerm = data?.activeTerm?.term ?? null

  return (
    <>
      <LearnerHeader activeTerm={activeTerm} streak={data?.streak ?? null} timetables={timetables} />
      {error ? (
        <div className="lhx-card">
          <ErrorState onRetry={refresh}>
            We couldn’t load your dashboard. Check your connection and try again.
          </ErrorState>
        </div>
      ) : (
        <>
          <PastPapersHero
            grade={grade}
            papersMeta={data?.papersMeta}
            paperResume={data?.paperResume}
            loading={loading}
          />
          <ContinueLearningCard
            resume={data?.learningResume}
            activeTerm={activeTerm}
            loading={loading}
          />
          {!loading && <TodaysExamsCard todaysExams={data?.todaysExams} streak={data?.streak || 0} />}
          <QuickAccessGrid />
          {/* Approved order: My Subjects → Timetable/countdown →
              Recommended → Daily Game → Recent Activity → Achievements.
              On desktop .lhx-cols reflows this same order into two
              columns (CSS multi-column) without changing the DOM. */}
          <div className="lhx-cols">
            <div className="lhx-colitem"><MySubjectsSection subjects={data?.subjects} activeTerm={activeTerm} loading={loading} /></div>
            <div className="lhx-colitem"><RecommendationsSection recommendations={data?.recommendations} loading={loading} /></div>
            {!loading && <div className="lhx-colitem"><DailyGameChallengeCard challenge={data?.gameChallenge} /></div>}
            <div className="lhx-colitem"><RecentActivitySection recentActivity={data?.recentActivity} loading={loading} /></div>
            {!loading && <div className="lhx-colitem"><AchievementsSummary streak={data?.streak || 0} xp={data?.xp || 0} /></div>}
          </div>
        </>
      )}
    </>
  )
}
