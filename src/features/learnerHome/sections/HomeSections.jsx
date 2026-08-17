/**
 * The two list sections the mockup's Home carries below the cards:
 * Explore (the four gradient tiles) and My Subjects.
 *
 * The mockup's Home is exactly five blocks — countdown, Continue,
 * Today's Quiz, Explore, My subjects — so Recommended, the Daily Game
 * Challenge, Recent Activity and the Achievements summary left with
 * this step. Nothing they surfaced is lost: recent results live on
 * /my-results, achievements on /profile (the badge shelf and the XP
 * bar), and the daily game on the games hub's own challenge card.
 *
 * Data still arrives pre-shaped from useLearnerDashboard — these
 * render only (spec §18: no per-card queries).
 */
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { ProgressBar, EmptyState, SectionSkeleton } from '../components/LearnerPrimitives'
import { capture } from '../../../utils/analytics'

// ── Explore (prototype .big-grid / .big-tile) ───────────────────────

// The mockup's four tiles, in its order. Timetable joined them in
// prototype v7 — it was the fourth tile the exam-countdown work never
// added, so the timetable was previously reachable only from the
// countdown itself.
const EXPLORE_TILES = [
  { key: 'papers', icon: '📄', title: 'Past Papers', sub: 'ECZ papers', to: '/papers', tone: 'lhx-bt-papers' },
  { key: 'notes', icon: '📚', title: 'Notes', sub: 'Read & revise', to: '/notes', tone: 'lhx-bt-notes' },
  { key: 'games', icon: '🎮', title: 'Games', sub: 'Play & learn', to: '/games', tone: 'lhx-bt-games' },
  { key: 'timetable', icon: '📅', title: 'Timetable', sub: 'Exam dates', to: '/timetable', tone: 'lhx-bt-time' },
]

export function ExploreGrid() {
  const navigate = useNavigate()
  return (
    <section className="lhx-section" aria-labelledby="lhx-explore-title">
      <div className="lhx-section-head">
        <h2 id="lhx-explore-title" className="lhx-section-title">Explore</h2>
      </div>
      <div className="lhx-explore">
        {EXPLORE_TILES.map((tile) => (
          <button
            key={tile.key}
            type="button"
            className={`lhx-tile ${tile.tone} lhx-press`}
            aria-label={`${tile.title} — ${tile.sub}`}
            onClick={() => { capture('explore_opened', { tile: tile.key }); navigate(tile.to) }}
          >
            <span className="lhx-tile-icon" aria-hidden="true">{tile.icon}</span>
            <span className="lhx-tile-name">{tile.title}</span>
            <span className="lhx-tile-sub">{tile.sub}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ── My Subjects ─────────────────────────────────────────────────────

const SUBJECT_TINTS = ['lhx-tint-green', 'lhx-tint-blue', 'lhx-tint-pink', 'lhx-tint-orange', 'lhx-tint-purple']
const SUBJECT_TONES = ['var(--lhx-green)', 'var(--lhx-blue)', 'var(--lhx-pink)', 'var(--lhx-orange)', 'var(--lhx-purple)']

export function MySubjectsSection({ subjects, activeTerm, loading }) {
  const navigate = useNavigate()
  // Every subject the grade is taught, always. This used to render only
  // the subjects that already had material — so a learner whose school had
  // one published note saw ONE subject card where the mockup shows seven,
  // and the list silently changed shape as content landed. A subject with
  // nothing published yet is still a subject the child takes; it shows at
  // 0% and says so when opened.

  return (
    <section className="lhx-section" aria-labelledby="lhx-subjects-title">
      <div className="lhx-section-head">
        <h2 id="lhx-subjects-title" className="lhx-section-title">My subjects</h2>
        {/* The mockup's "Term 2" see-all slot. It states the term the
            percentages are measured over, which is the one thing that
            makes them readable — it is a label, not a link. */}
        {activeTerm && <span className="lhx-see-all">Term {activeTerm}</span>}
      </div>
      {loading ? (
        <SectionSkeleton lines={4} height={56} />
      ) : (subjects || []).length === 0 ? (
        <div className="lhx-card"><EmptyState icon="learn">Your subjects will appear here once your grade is set.</EmptyState></div>
      ) : (
        <div className="lhx-subjects">
          {(subjects || []).map((s, i) => (
            <button
              key={s.id}
              type="button"
              className="lhx-subject-row lhx-press"
              onClick={() => {
                capture('subject_opened', { subject: s.id, from: 'dashboard' })
                navigate(`/subjects/${s.id}`)
              }}
            >
              <span className={`lhx-subject-icon ${SUBJECT_TINTS[i % SUBJECT_TINTS.length]}`} aria-hidden="true">
                <LearnerIcon name={subjectIconName(s.id)} size={22} />
              </span>
              <span className="lhx-subject-main">
                <span className="lhx-subject-name">{s.label}</span>
                <span className="lhx-subject-meta" style={{ display: 'block' }}>
                  {[activeTerm ? `Term ${activeTerm}` : null, s.topicCount ? `${s.topicCount} topics` : null].filter(Boolean).join(' · ')}
                </span>
                <ProgressBar percent={s.percent} tone={SUBJECT_TONES[i % SUBJECT_TONES.length]} label={`${s.label}: ${s.percent}% complete`} />
              </span>
              <span className="lhx-subject-pct" style={{ color: SUBJECT_TONES[i % SUBJECT_TONES.length] }}>{s.percent}%</span>
              <ChevronRight size={18} className="lhx-chevron" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
