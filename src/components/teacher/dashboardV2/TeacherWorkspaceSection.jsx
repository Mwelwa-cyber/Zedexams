import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  ClipboardList,
  LayoutGrid,
} from 'lucide-react'
import { STUDIO_CATEGORIES, TEACHER_STUDIOS } from './launcher/teacherStudios'
import { resolveBadge } from './launcher/teacherLauncherCore'
import useGlassTile from '../../../hooks/useGlassTile'
import './teacherWorkspaceSection.css'

/**
 * The DESKTOP Teacher Workspace — the classic card layout, restored at the
 * owner's request (2026-07-23): large descriptive cards grouped by category
 * with saved-count pills and a "View all teacher tools" expander. Mobile
 * (< 768px) keeps the compact app-icon launcher; this section renders only
 * in the desktop DashboardView.
 *
 * Content comes from the SAME canonical registry as the launcher
 * (launcher/teacherStudios.js) — titles, routes, descriptions, icons and
 * badge sources are never re-declared here.
 */

/* The classic view features four cards per category; everything else lives
   behind the expander. Ids only — all content resolves from the registry. */
const FEATURED = {
  planning: ['schemes', 'weekly-focus', 'lesson-plans', 'record-of-work'],
  materials: ['worksheets', 'notes', 'homework', 'visual-studio'],
  assessment: ['assessment-papers', 'question-bank', 'mark-schedule', 'rubrics'],
}

const SECTION_META = {
  planning: { icon: ClipboardList, viewAllTo: '/teacher/library' },
  materials: { icon: BookOpen, viewAllTo: '/teacher/library' },
  assessment: { icon: ClipboardCheck, viewAllTo: '/teacher/assessment-papers' },
}

const BY_ID = Object.fromEntries(TEACHER_STUDIOS.map((s) => [s.id, s]))
const FEATURED_IDS = new Set(Object.values(FEATURED).flat())
const MORE_TOOLS = TEACHER_STUDIOS.filter((s) => !FEATURED_IDS.has(s.id))

function StudioCard({ studio, badge, pending }) {
  const Icon = studio.icon
  const badgeLabel = badge ? `, ${badge.label}` : ''
  const tileRef = useGlassTile()
  return (
    <Link
      ref={tileRef}
      to={studio.route}
      className="tws-card"
      aria-label={`${studio.title}${badgeLabel}. Open studio`}
    >
      <span className="tws-sheen" aria-hidden="true" />
      <span className="tws-card-top">
        <span
          className={`tws-card-icon ${studio.image ? 'is-img' : `tint-${studio.tint || 'teal'}`}`}
          aria-hidden="true"
        >
          {studio.image ? (
            <img src={studio.image} alt="" loading="lazy" draggable="false" />
          ) : (
            <Icon size={22} strokeWidth={1.9} />
          )}
        </span>
        {pending ? (
          <span className="tws-pill is-skeleton" aria-hidden="true" />
        ) : badge?.type === 'saved' ? (
          <span className="tws-pill kind-saved" aria-hidden="true">{badge.count} SAVED</span>
        ) : badge?.type === 'new' ? (
          <span className="tws-pill kind-new" aria-hidden="true">NEW</span>
        ) : badge?.type === 'warning' ? (
          <span className="tws-dot" aria-hidden="true" />
        ) : null}
      </span>
      <span className="tws-card-title">{studio.title}</span>
      <span className="tws-card-desc">{studio.description}</span>
      <ArrowRight size={16} strokeWidth={2} className="tws-card-arrow" aria-hidden="true" />
    </Link>
  )
}

export default function TeacherWorkspaceSection({
  savedCounts = null,
  warnings = [],
  loading = false,
  allToolsOpen = false,
  onToggleAllTools,
}) {
  const warningSet = useMemo(() => new Set(warnings), [warnings])
  const badgeFor = (studio) => resolveBadge(studio, savedCounts, { warnings: warningSet })
  const pendingFor = (studio) => loading && Boolean(studio.countKey) && savedCounts == null

  return (
    <section className="tws" aria-label="Teacher Workspace">
      <header className="tws-head">
        <span className="tws-head-chip" aria-hidden="true">
          <LayoutGrid size={22} strokeWidth={2} />
        </span>
        <div>
          <h2 className="tws-title">Teacher Workspace</h2>
          <p className="tws-sub">Your main tools — expand for everything else</p>
        </div>
      </header>

      {STUDIO_CATEGORIES.filter((c) => FEATURED[c.id]).map((c) => {
        const SecIcon = SECTION_META[c.id].icon
        return (
          <div key={c.id} className={`tws-sec tws-sec--${c.id}`}>
            <div className="tws-sec-head">
              <span className="tws-sec-chip" aria-hidden="true">
                <SecIcon size={16} strokeWidth={2} />
              </span>
              <h3 className="tws-sec-title">{c.label}</h3>
              <Link className="tdv2-link-action tws-sec-viewall" to={SECTION_META[c.id].viewAllTo}>
                View all
                <ArrowRight size={15} strokeWidth={2} aria-hidden="true" />
              </Link>
            </div>
            <div className="tws-grid">
              {FEATURED[c.id].map((id) => {
                const studio = BY_ID[id]
                if (!studio) return null
                return (
                  <StudioCard
                    key={id}
                    studio={studio}
                    badge={badgeFor(studio)}
                    pending={pendingFor(studio)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}

      {allToolsOpen ? (
        <div className="tws-sec tws-sec--more" id="tws-all-tools">
          <div className="tws-sec-head">
            <span className="tws-sec-chip" aria-hidden="true">
              <LayoutGrid size={16} strokeWidth={2} />
            </span>
            <h3 className="tws-sec-title">More tools</h3>
          </div>
          <div className="tws-grid">
            {MORE_TOOLS.map((studio) => (
              <StudioCard
                key={studio.id}
                studio={studio}
                badge={badgeFor(studio)}
                pending={pendingFor(studio)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="tws-expand"
        aria-expanded={allToolsOpen}
        aria-controls="tws-all-tools"
        onClick={() => onToggleAllTools?.(!allToolsOpen)}
      >
        {allToolsOpen ? 'Hide extra tools' : `View all teacher tools (${MORE_TOOLS.length} more)`}
        {allToolsOpen ? (
          <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </section>
  )
}
