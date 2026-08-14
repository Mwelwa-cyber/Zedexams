/**
 * QuickCreate — the dashboard's four primary create actions (redesign §7).
 *
 * Replaces the "Your activity" statistics block in the main flow: instead of
 * percentages, the teacher gets straight paths into the four studios that
 * make up the weekly routine. Each card opens the existing studio route —
 * studios keep their own draft/profile prefill, so grade + subject context
 * carries over exactly as it does today. "View all teacher tools" jumps to
 * the full Teacher Workspace section further down the page.
 */

import { Link } from 'react-router-dom'
import Icon from '../../shared/components/Icon'
import { ArrowRight } from '../../shared/components/icons'
import { capture } from '../../utils/analytics'
import { buildGeneratorQueryString } from '../../utils/useFormDefaultsFromUrl'
import iconLessonPlan from '../../assets/teacher-icons/lesson-plan.webp'
import iconWeeklyForecast from '../../assets/teacher-icons/weekly-forecast.webp'
import iconWorksheet from '../../assets/teacher-icons/worksheet.webp'
import iconAssessments from '../../assets/teacher-icons/assessments.webp'
import useStudioAvailability from '../../hooks/useStudioAvailability'

/* Five declared, four shown. Worksheets is withdrawn behind a feature flag,
   and Homework — the practice-generation surface while worksheets are away —
   takes the freed slot rather than leaving the row of four a row of three.
   Homework is last because it is the entry that yields when the flag is on. */
const ACTION_COUNT = 4

const ACTIONS = [
  {
    key: 'lesson_plan',
    img: iconLessonPlan,
    tone: 'orange',
    title: 'Lesson Plan',
    text: 'Plan a lesson with teaching stages, resources and assessment.',
    to: '/teacher/lesson-plans/new',
  },
  {
    key: 'weekly_focus',
    img: iconWeeklyForecast,
    tone: 'violet',
    title: 'Weekly Focus',
    text: 'Prepare the teaching week from your Scheme of Work and timetable.',
    to: '/teacher/generate/weekly-forecast',
  },
  {
    key: 'worksheet',
    img: iconWorksheet,
    tone: 'green',
    title: 'Worksheet',
    text: 'Create classroom practice, exercises and consolidation tasks.',
    to: '/teacher/generate/worksheet',
  },
  {
    key: 'assessment_paper',
    img: iconAssessments,
    tone: 'blue',
    title: 'Assessment Paper',
    text: 'Build tests, mock exams and formal examinations.',
    to: '/teacher/assessment-papers/new',
  },
  {
    key: 'homework',
    // This icon set has no homework artwork; the classic workspace's Homework
    // Studio tile reuses the worksheet icon for the same reason.
    img: iconWorksheet,
    tone: 'green',
    title: 'Homework',
    text: 'Set homework with model answers and marking guidance.',
    to: '/teacher/generate/homework',
  },
]

export default function QuickCreate({ context = null, onViewAllTools }) {
  const { filterEntries } = useStudioAvailability()
  // Seed each studio with the active Teaching Profile context (grade/subject/
  // term) when one is available, so Quick Create opens on the right teaching
  // context rather than the generic profile default.
  const qs = context ? buildGeneratorQueryString({ grade: context.grade, subject: context.subject, term: context.term }) : ''
  return (
    <section className="teacher-quickcreate" aria-label="Quick create">
      <div className="teacher-section-head">
        <div className="teacher-dashboard-eyebrow">Quick create</div>
        {/* Button, not an anchor: expands the full workspace (via the
            dashboard's callback), scrolls to the section on this same page,
            and moves keyboard focus to its heading — no #hash in the URL. */}
        <button
          type="button"
          className="teacher-section-head__link teacher-section-head__link--button"
          onClick={() => {
            capture('teacher_workspace_expanded', { from: 'quick-create' })
            onViewAllTools?.()
            const section = document.getElementById('teacher-workspace')
            section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
            document.getElementById('teacher-workspace-title')?.focus?.({ preventScroll: true })
          }}
        >
          View all teacher tools
        </button>
      </div>
      <div className="teacher-quickcreate__grid">
        {filterEntries(ACTIONS).slice(0, ACTION_COUNT).map((a) => (
          <Link
            key={a.key}
            to={`${a.to}${qs}`}
            className={`teacher-quickcreate-card teacher-quickcreate-card--${a.tone}`}
            onClick={() => capture('quick_create_selected', { tool: a.key })}
          >
            <span className="teacher-quickcreate-card__icon">
              <img src={a.img} alt="" aria-hidden="true" width="44" height="44" loading="lazy" decoding="async" />
            </span>
            <span className="teacher-quickcreate-card__title">{a.title}</span>
            <span className="teacher-quickcreate-card__text">{a.text}</span>
            <span className="teacher-quickcreate-card__go" aria-hidden="true">
              <Icon as={ArrowRight} size="sm" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
