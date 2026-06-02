import { Link } from 'react-router-dom'
import { ChevronLeft } from '../ui/icons'
import Icon from '../ui/Icon'
import SeoHelmet from '../seo/SeoHelmet'
import MobileBottomNav from '../layout/MobileBottomNav'
import TodayStudyPlan from './TodayStudyPlan'
import { useStudyPlanData } from '../../hooks/useStudyPlanData'

/**
 * Dedicated /study-plan page. The full plan card used to sit high on the
 * dashboard where it felt cramped on phones; it now lives on its own focused
 * page, reached from the compact <StudyPlanCard> on the dashboard.
 */
export default function StudyPlanPage() {
  const { results, weakTopics, grade, streak, dailyGoal, aiNotesOn, loading } = useStudyPlanData()

  return (
    <div className="learner-game-theme min-h-screen theme-bg flex flex-col">
      <SeoHelmet title="Today's Study Plan" path="/study-plan" noIndex />
      <main className="relative z-10 mx-auto w-full max-w-2xl flex-1 space-y-4 px-3 py-5 pb-28 sm:px-4 theme-text">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1 rounded-full theme-bg-subtle px-3 py-1.5 text-xs font-black theme-accent-text hover:opacity-90"
        >
          <Icon as={ChevronLeft} size="xs" strokeWidth={2.4} />
          Dashboard
        </Link>

        <div>
          <h1 className="learner-page-heading text-display-md">Today&apos;s Study Plan</h1>
          <p className="theme-text-muted mt-1 text-sm font-bold">
            A short, personalised checklist to keep your revision on track.
          </p>
        </div>

        <TodayStudyPlan
          results={results}
          weakTopics={weakTopics}
          grade={grade}
          streak={streak}
          dailyGoal={dailyGoal}
          loading={loading}
          aiNotesOn={aiNotesOn}
        />
      </main>
      <MobileBottomNav className="learner-bottom-nav" />
    </div>
  )
}
