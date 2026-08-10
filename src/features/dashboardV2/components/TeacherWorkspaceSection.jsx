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
import { STUDIO_CATEGORIES, TEACHER_STUDIOS } from '../../../components/teacher/dashboardV2/launcher/teacherStudios'
import { resolveBadge } from '../../../components/teacher/dashboardV2/launcher/teacherLauncherCore'
import useStudioAvailability from '../../../hooks/useStudioAvailability'
import StudioCard from './StudioCard'
import '../../../components/teacher/dashboardV2/glassSurface.css'
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
  assessment: ['assessment-papers', 'mark-schedule', 'sba'],
}

/** How many cards a category shows before the expander. */
const FEATURED_SIZE = 4

const SECTION_META = {
  planning: { icon: ClipboardList, viewAllTo: '/teacher/library' },
  materials: { icon: BookOpen, viewAllTo: '/teacher/library' },
  assessment: { icon: ClipboardCheck, viewAllTo: '/teacher/assessment-papers' },
}

const BY_ID = Object.fromEntries(TEACHER_STUDIOS.map((s) => [s.id, s]))

/**
 * The cards each category shows, resolved against the studios actually on
 * offer.
 *
 * A withdrawn studio must not simply leave a gap: `materials` features
 * Worksheets, so with the flag off the row would show three cards while a
 * fourth materials studio sat behind the expander. The declared ids come
 * first, then the row is topped back up to four from the same category in
 * registry order — so the layout is the same whichever way the flag is set,
 * and flipping it on restores the declared order exactly.
 */
function featuredLayout(studios) {
  const available = new Set(studios.map((s) => s.id))
  const featured = {}
  const taken = new Set()
  for (const [category, ids] of Object.entries(FEATURED)) {
    const picked = ids.filter((id) => available.has(id))
    for (const studio of studios) {
      if (picked.length >= FEATURED_SIZE) break
      if (studio.category === category && !picked.includes(studio.id)) picked.push(studio.id)
    }
    featured[category] = picked
    picked.forEach((id) => taken.add(id))
  }
  return { featured, more: studios.filter((s) => !taken.has(s.id)) }
}

export default function TeacherWorkspaceSection({
  savedCounts = null,
  warnings = [],
  loading = false,
  allToolsOpen = false,
  onToggleAllTools,
}) {
  const warningSet = useMemo(() => new Set(warnings), [warnings])
  const { filterEntries } = useStudioAvailability()
  const { featured, more: moreTools } = useMemo(
    () => featuredLayout(filterEntries(TEACHER_STUDIOS, 'route')),
    [filterEntries],
  )
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

      {STUDIO_CATEGORIES.filter((c) => featured[c.id]?.length).map((c) => {
        const SecIcon = SECTION_META[c.id].icon
        return (
          <div key={c.id} className={`tws-sec glass-panel glass-panel--${c.id}`}>
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
              {featured[c.id].map((id) => {
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
        <div className="tws-sec glass-panel" id="tws-all-tools">
          <div className="tws-sec-head">
            <span className="tws-sec-chip" aria-hidden="true">
              <LayoutGrid size={16} strokeWidth={2} />
            </span>
            <h3 className="tws-sec-title">More tools</h3>
          </div>
          <div className="tws-grid">
            {moreTools.map((studio) => (
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
        {allToolsOpen ? 'Hide extra tools' : `View all teacher tools (${moreTools.length} more)`}
        {allToolsOpen ? (
          <ChevronUp size={16} strokeWidth={2} aria-hidden="true" />
        ) : (
          <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
        )}
      </button>
    </section>
  )
}
