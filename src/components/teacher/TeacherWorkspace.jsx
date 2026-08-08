/**
 * TeacherWorkspace — the dashboard's studio grid, simplified (redesign §10).
 *
 * Three primary groups (Planning / Teaching Materials / Assessment, four
 * tiles each) render by default; "View all teacher tools" expands the
 * remaining groups in place — nothing is deleted, tools only leave the
 * first view. Saved-count badges render ONLY when the count is above zero
 * (a "0 saved" badge is noise); NEW badges stay reserved for genuinely
 * recent tools, and Free-plan teachers still see the 🔒 Sample badge on
 * Pro/Max-only studios.
 *
 * Extracted from TeacherDashboard.jsx so the grid, its config, and the
 * expansion behaviour are testable in isolation.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../ui/Icon'
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronDown,
  ClipboardCheckList,
  ClipboardList,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutGrid,
} from '../ui/icons'
import { capture } from '../../utils/analytics'
import useStudioAvailability from '../../hooks/useStudioAvailability'
// 3D studio tile icons (optimised WebP, ~2KB each), one per tile.
import iconClassRegister from '../../assets/teacher-icons/class-register.webp'
import iconVisualStudio from '../../assets/teacher-icons/visual-studio.webp'
import iconSchemeOfWork from '../../assets/teacher-icons/scheme-of-work.webp'
import iconWeeklyForecast from '../../assets/teacher-icons/weekly-forecast.webp'
import iconRecordOfWork from '../../assets/teacher-icons/record-of-work.webp'
import iconMarkSchedule from '../../assets/teacher-icons/mark-schedule.webp'
import iconClassTimetable from '../../assets/teacher-icons/class-timetable.webp'
import iconLessonPlan from '../../assets/teacher-icons/lesson-plan.webp'
import iconNotesStudio from '../../assets/teacher-icons/notes-studio.webp'
import iconWorksheet from '../../assets/teacher-icons/worksheet.webp'
import iconFlashcards from '../../assets/teacher-icons/flashcards.webp'
import iconAssessments from '../../assets/teacher-icons/assessments.webp'
import iconSbaStudio from '../../assets/teacher-icons/sba-studio.webp'
import iconLibrary from '../../assets/teacher-icons/library.webp'
import iconSchoolCalendar from '../../assets/teacher-icons/school-calendar.webp'
import iconSyllabiStudio from '../../assets/teacher-icons/syllabi-studio.webp'

/* The three primary groups the dashboard shows by default (§10). */
export const PRIMARY_GROUPS = [
  {
    label: 'Planning',
    icon: ClipboardList,
    accent: 'amber',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconSchemeOfWork,
        tone: 'amber',
        badge: null,
        libraryKey: 'scheme-of-work',
        title: 'Schemes of Work',
        tagline: 'Map term pacing, outcomes, and weekly checkpoints.',
        to: '/teacher/generate/scheme-of-work',
      },
      {
        img: iconWeeklyForecast,
        tone: 'blue',
        badge: null,
        libraryKey: 'weekly-forecast',
        title: 'Weekly Focus',
        tagline: 'Plan the week day by day from your scheme, syllabus and timetable.',
        to: '/teacher/generate/weekly-forecast',
      },
      {
        img: iconLessonPlan,
        tone: 'orange',
        badge: null,
        libraryKey: 'lesson-plan',
        title: 'Lesson Plans',
        tagline: 'Prepare CBC lessons with stages, resources, and assessment.',
        to: '/teacher/lesson-plans/new',
      },
      {
        img: iconRecordOfWork,
        tone: 'cyan',
        badge: null,
        libraryKey: 'record-of-work',
        title: 'Record of Work',
        tagline: 'Log what you actually taught each week, checked against your scheme.',
        to: '/teacher/generate/record-of-work',
      },
    ],
  },
  {
    label: 'Teaching Materials',
    icon: BookOpen,
    accent: 'blue',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconWorksheet,
        tone: 'green',
        badge: null,
        libraryKey: 'worksheet',
        title: 'Worksheets',
        tagline: 'Create classroom practice, exercises, and consolidation tasks.',
        to: '/teacher/generate/worksheet',
      },
      {
        img: iconNotesStudio,
        tone: 'blue',
        badge: null,
        libraryKey: 'notes',
        title: 'Notes Studio',
        tagline: 'Turn a lesson plan into delivery notes and examples.',
        to: '/teacher/generate/notes',
      },
      {
        img: iconWorksheet,
        tone: 'sky',
        badge: null,
        libraryKey: 'homework',
        title: 'Homework Studio',
        tagline: 'Short take-home practice with an answer key and a parent note.',
        to: '/teacher/generate/homework',
      },
      {
        img: iconVisualStudio,
        tone: 'orange',
        badge: 'NEW',
        libraryKey: null,
        title: 'Visual Studio',
        tagline: 'Make labelled diagrams & test pictures, then send to a studio.',
        to: '/teacher/visual-studio',
      },
    ],
  },
  {
    label: 'Assessment',
    icon: ClipboardCheckList,
    accent: 'violet',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconAssessments,
        tone: 'violet',
        badge: null,
        title: 'Assessment Paper Studio',
        tagline: 'Create topic tests, weekly tests, end-of-term tests, mock examinations, and formal examination papers.',
        to: '/teacher/assessment-papers',
      },
      {
        img: iconMarkSchedule,
        tone: 'green',
        badge: null,
        libraryKey: 'mark-schedule',
        title: 'Mark Schedule',
        tagline: 'Marks in — totals, class positions and report comments out.',
        to: '/teacher/generate/mark-schedule',
      },
    ],
  },
]

/* Everything else — revealed by "View all teacher tools". Nothing deleted. */
export const MORE_GROUPS = [
  {
    label: 'Planning & Setup',
    icon: CalendarDays,
    accent: 'indigo',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconSyllabiStudio,
        tone: 'sky',
        badge: null,
        title: 'Syllabus Studio',
        tagline: 'Browse CBC subjects, topics, competences, and standards.',
        to: '/teacher/syllabi',
      },
      {
        img: iconSyllabiStudio,
        tone: 'indigo',
        badge: null,
        title: 'Curriculum',
        tagline: 'Browse the full CBC and 2013 curriculum structures.',
        to: '/teacher/curriculum',
      },
      {
        img: iconSchoolCalendar,
        tone: 'indigo',
        badge: null,
        title: 'School Calendar',
        tagline: 'Check MoE terms, public holidays, and working days.',
        to: '/teacher/calendar',
      },
      {
        img: iconLessonPlan,
        tone: 'amber',
        badge: 'NEW',
        libraryKey: null,
        title: 'Template Bank',
        tagline: 'Find, copy and customise ready-made, curriculum-aligned lesson plan templates.',
        to: '/teacher/templates',
      },
      {
        img: iconClassRegister,
        tone: 'green',
        badge: 'NEW',
        libraryKey: null,
        title: 'Class List',
        tagline: 'Build one class list per class — SBA, marks and reports load every learner.',
        to: '/teacher/register',
      },
      {
        img: iconMarkSchedule,
        tone: 'sky',
        badge: 'NEW',
        libraryKey: null,
        title: 'Class Register',
        tagline: 'Mark daily attendance and print the official class register.',
        to: '/teacher/attendance',
      },
      {
        img: iconClassTimetable,
        tone: 'violet',
        badge: null,
        libraryKey: 'class-timetable',
        title: 'Class Timetable',
        tagline: 'Auto-fill a balanced week from the curriculum subjects.',
        to: '/teacher/generate/class-timetable',
      },
    ],
  },
  {
    label: 'More Creation Tools',
    icon: Layers,
    accent: 'yellow',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconFlashcards,
        tone: 'yellow',
        badge: null,
        libraryKey: 'flashcards',
        title: 'Flashcards',
        tagline: 'Build short revision prompts for recall and practice.',
        to: '/teacher/generate/flashcards',
      },
    ],
  },
  {
    // All three SBA tools live together so teachers see at a glance that
    // they belong to the ECZ School Based Assessment workflow.
    label: 'School Based Assessment (SBA)',
    icon: GraduationCap,
    accent: 'blue',
    viewAll: '/teacher/sba',
    description:
      'ECZ School Based Assessment — Grades 5–7 only, worth 30% of the final Grade 7 mark (10% banked per grade). Create tasks, record marks and track coverage. These are not for ordinary class tests — use the Assessment Paper Studio for those. New to SBA? Tap “View all” for a short how-to guide.',
    items: [
      {
        img: iconSbaStudio,
        tone: 'sky',
        badge: null,
        libraryKey: 'sba-task',
        title: 'SBA Studio',
        tagline: 'Step 1 · Create an ECZ-compliant SBA task — the right task type, Bloom level and marking scheme. Never multiple-choice.',
        to: '/teacher/generate/sba',
      },
      {
        img: iconSbaStudio,
        tone: 'cyan',
        badge: null,
        title: 'SBA Mark Tracker',
        tagline: 'Step 2 · Enter each pupil’s task marks; the 10%-per-grade SBA mark converts for you, ready for the ECZ OMES portal.',
        to: '/teacher/generate/sba-tracker',
      },
      {
        img: iconSbaStudio,
        tone: 'green',
        badge: null,
        title: 'SBA Year Planner',
        tagline: 'Step 3 · Plan every required task across the year and track each one Planned → Administered → Marked.',
        to: '/teacher/generate/sba-planner',
      },
    ],
  },
  {
    label: 'Library',
    icon: FolderOpen,
    accent: 'slate',
    viewAll: '/teacher/library',
    items: [
      {
        img: iconLibrary,
        tone: 'slate',
        badge: null,
        isLibrary: true,
        title: 'My Library',
        tagline: 'All your saved plans, notes, homework and assessments.',
        to: '/teacher/library',
      },
      {
        img: iconLibrary,
        tone: 'slate',
        badge: null,
        title: 'Recovery Centre',
        tagline: 'Every unfinished draft across your studios — resume or clear it out.',
        to: '/teacher/drafts',
      },
    ],
  },
]

// Studio tile routes that stay Pro/Max only — a Free teacher who opens one
// sees a read-only sample (StudioGate), so the tile is badged "Sample".
// Schemes of Work, Worksheets, Homework and Assessment Papers left this set
// in the free-preview phase (§12): Free now opens them with limited
// allowances (PLAN_LIMITS.free) and preview shaping (FREE_PREVIEW_LIMITS).
// The Assessment Paper Studio (tests AND examinations, one merged studio) is
// gated identically for every assessment type via StudioGate tool="assessment"
// — there's no route-level distinction to badge "Sample" here any more.
const LOCKED_STUDIO_PATHS = new Set([
  '/teacher/generate/weekly-forecast',
  '/teacher/generate/record-of-work',
  '/teacher/generate/class-timetable',
  '/teacher/generate/notes',
  '/teacher/generate/flashcards',
  '/teacher/generate/mark-schedule',
  '/teacher/generate/sba',
  '/teacher/generate/sba-tracker',
  '/teacher/generate/sba-planner',
])

/* The expander's count follows what the expander will actually show — a
   withdrawn studio must not be advertised as one of the "N more". */
function moreToolCount(isRouteAvailable) {
  return MORE_GROUPS.reduce(
    (n, g) => n + g.items.filter((s) => isRouteAvailable(s.to)).length,
    0,
  )
}

function WorkspaceSectionHead({ icon, accent, label, viewAll, description }) {
  return (
    <div className="teacher-workspace-section__head">
      <span className={`teacher-workspace-section__icon teacher-workspace-section__icon--${accent || 'amber'}`}>
        <Icon as={icon} size="sm" />
      </span>
      <div className="teacher-workspace-section__titles">
        <span className="teacher-workspace-section__label">{label}</span>
        {description && (
          <span className="teacher-workspace-section__desc">{description}</span>
        )}
      </div>
      {viewAll && (
        <Link to={viewAll} className="teacher-workspace-section__viewall">
          View all
          <Icon as={ArrowRight} size="xs" />
        </Link>
      )}
    </div>
  )
}

function StudioCard({ img, tone, badge, libraryKey, isLibrary, title, tagline, to, librarySummary, locked, area }) {
  // STUDIOS uses dash-cased libraryKeys ('lesson-plan') but byTool is keyed
  // by the snake_cased Firestore tool ids ('lesson_plan') — normalize or the
  // saved count never matches.
  const count = libraryKey
    ? (librarySummary?.byTool?.[libraryKey.replace(/-/g, '_')] ?? 0)
    : isLibrary
    ? (librarySummary?.total ?? 0)
    : null
  // A badge renders only when it carries real signal: the Free-plan 🔒
  // Sample marker, an explicit NEW/FREE badge, or a saved-count ABOVE zero —
  // "0 saved" is suppressed entirely (§10).
  const showBadge = locked || badge !== null || (count !== null && count > 0)
  const badgeText = locked ? '🔒 Sample' : badge !== null ? badge : `${count} saved`
  const badgeClass = locked
    ? 'teacher-workspace-card__badge--muted'
    : badge === 'FREE'
    ? 'teacher-workspace-card__badge--success'
    : badge === 'NEW'
    ? 'teacher-workspace-card__badge--accent'
    : 'teacher-workspace-card__badge--saved'
  const cardClass = ['teacher-workspace-card', `teacher-workspace-card--${tone || 'slate'}`].join(' ')

  // Saved-count badges get a full accessible label ("4 saved documents");
  // NEW/Sample badges read out their visible text as-is.
  const badgeAria = !locked && badge === null && count !== null && count > 0
    ? `${count} saved document${count === 1 ? '' : 's'}`
    : undefined

  return (
    <Link
      to={to}
      className={cardClass}
      onClick={() => capture('workspace_tool_selected', { tool: title, area })}
    >
      <div className="teacher-workspace-card__top">
        <span className="teacher-workspace-card__icon">
          <img
            className="teacher-workspace-card__icon-img"
            src={img}
            alt=""
            aria-hidden="true"
            width="44"
            height="44"
            loading="lazy"
            decoding="async"
          />
        </span>
        {showBadge && (
          <span className={`teacher-workspace-card__badge ${badgeClass}`} aria-label={badgeAria}>
            {badgeText}
          </span>
        )}
      </div>
      <p className="teacher-workspace-card__title">{title}</p>
      <p className="teacher-workspace-card__text">{tagline}</p>
    </Link>
  )
}

function WorkspaceGroup({ group, librarySummary, isFreePlan, area }) {
  const { filterEntries } = useStudioAvailability()
  const items = filterEntries(group.items)
  // A group whose every tile is a withdrawn studio would render a heading over
  // an empty grid.
  if (!items.length) return null
  return (
    <section className="teacher-workspace-section teacher-defer">
      <WorkspaceSectionHead
        icon={group.icon}
        accent={group.accent}
        label={group.label}
        viewAll={group.viewAll}
        description={group.description}
      />
      <div className="teacher-workspace-grid">
        {items.map((s) => (
          <StudioCard
            key={s.title}
            {...s}
            librarySummary={librarySummary}
            locked={isFreePlan && LOCKED_STUDIO_PATHS.has(s.to)}
            area={area}
          />
        ))}
      </div>
    </section>
  )
}

export default function TeacherWorkspace({ librarySummary, isFreePlan, expanded, onToggle }) {
  const { isRouteAvailable } = useStudioAvailability()
  const moreCount = moreToolCount(isRouteAvailable)
  // Uncontrolled fallback so the component also works standalone (tests).
  const [selfExpanded, setSelfExpanded] = useState(false)
  const isExpanded = expanded ?? selfExpanded
  const toggle = () => {
    capture(isExpanded ? 'teacher_workspace_collapsed' : 'teacher_workspace_expanded', { from: 'workspace' })
    if (onToggle) onToggle(!isExpanded)
    else setSelfExpanded((v) => !v)
  }

  return (
    <>
      <div id="teacher-workspace" className="teacher-workspace-header teacher-defer">
        <span className="teacher-workspace-header__icon">
          <Icon as={LayoutGrid} size="md" />
        </span>
        <div>
          {/* Focus target for Quick Create's "View all teacher tools". */}
          <h2 id="teacher-workspace-title" tabIndex={-1} className="teacher-workspace-header__title">
            Teacher Workspace
          </h2>
          <p className="teacher-workspace-header__text">Your main tools — expand for everything else</p>
        </div>
      </div>

      {PRIMARY_GROUPS.map((group) => (
        <WorkspaceGroup key={group.label} group={group} librarySummary={librarySummary} isFreePlan={isFreePlan} area="primary" />
      ))}

      <button
        type="button"
        className="teacher-workspace-toggle teacher-defer"
        aria-expanded={isExpanded}
        aria-controls="teacher-workspace-more"
        onClick={toggle}
      >
        {isExpanded ? 'Show fewer tools' : `View all teacher tools (${moreCount} more)`}
        <Icon
          as={ChevronDown}
          size="xs"
          className={isExpanded ? 'teacher-usage-card__chevron is-open' : 'teacher-usage-card__chevron'}
        />
      </button>

      <div id="teacher-workspace-more">
        {isExpanded &&
          MORE_GROUPS.map((group) => (
            <WorkspaceGroup key={group.label} group={group} librarySummary={librarySummary} isFreePlan={isFreePlan} area="expanded" />
          ))}
      </div>
    </>
  )
}
