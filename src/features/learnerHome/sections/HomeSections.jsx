/**
 * The Home sections, and ONLY the ones the prototype's Home has:
 * Today's Quiz (the slim daily card), Explore (the four gradient tiles)
 * and My subjects. All data arrives pre-shaped from useLearnerDashboard
 * — these render only (spec §18: no per-card queries).
 *
 * What used to live here and why it is gone: Home carried a Quick Access
 * grid (Lessons · Notes · Past Papers · Quizzes), Recommended for You,
 * Recent Activity and an Achievements summary. None of those are in the
 * mockup — v3 through v6 all show exactly countdown → continue →
 * Today's Quiz → Explore → My subjects. The mockup is the spec, so the
 * extra sections were removed rather than restyled, and "Quick Access"
 * became "Explore" with the mockup's own four destinations (Past Papers,
 * Notes, Games, Timetable — no Lessons, no Quizzes).
 */
import { useNavigate, Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { ProgressBar, EmptyState, SectionSkeleton } from '../components/LearnerPrimitives'
import { capture } from '../../../utils/analytics'

// ── Today's Quiz (prototype .daily-slim) ────────────────────────────

export function TodaysQuizCard({ challenge, streak = 0 }) {
  const navigate = useNavigate()
  const game = challenge?.game || challenge
  if (!game || !game.id) return null

  return (
    <button
      type="button"
      className="lhx-daily-slim"
      onClick={() => {
        // A navigation, not a play: the engine emits game_started once the
        // round actually begins, so this must not double-count.
        capture('game_challenge_opened', { gameId: game.id, from: 'home_daily' })
        navigate(`/games/play/${game.id}`)
      }}
    >
      <span className="lhx-ds-icon" aria-hidden="true">
        <img src="/images/characters/poses/zed-waving.webp" alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="lhx-ds-title" style={{ display: 'block' }}>Today&rsquo;s Quiz</span>
        <span className="lhx-ds-sub" style={{ display: 'block' }}>
          {streak > 0 ? `with Zed · keep your ${streak}-day 🔥` : 'with Zed · start a streak 🔥'}
        </span>
      </span>
      <span className="lhx-play-pill" style={{ padding: '9px 18px', fontSize: 13 }}>Play</span>
    </button>
  )
}

// ── Explore (prototype .big-grid) ───────────────────────────────────

const EXPLORE_TILES = [
  { to: '/papers', icon: '📄', name: 'Past Papers', sub: 'ECZ papers', tint: 'lhx-bt-papers' },
  { to: '/notes', icon: '📚', name: 'Notes', sub: 'Read & revise', tint: 'lhx-bt-notes' },
  { to: '/games', icon: '🎮', name: 'Games', sub: 'Play & learn', tint: 'lhx-bt-games' },
  { to: '/timetable', icon: '📅', name: 'Timetable', sub: 'Exam dates', tint: 'lhx-bt-time' },
]

export function ExploreGrid() {
  return (
    <section className="lhx-section" aria-labelledby="lhx-explore-title">
      <div className="lhx-section-head">
        <h2 id="lhx-explore-title" className="lhx-section-title">Explore</h2>
      </div>
      <div className="lhx-big-grid">
        {EXPLORE_TILES.map((t) => (
          <Link key={t.to} to={t.to} className={`lhx-big-tile ${t.tint}`}>
            <div className="lhx-tile-icon" aria-hidden="true">{t.icon}</div>
            <div className="lhx-tile-name">{t.name}</div>
            <div className="lhx-tile-sub">{t.sub}</div>
          </Link>
        ))}
      </div>
    </section>
  )
}

// ── My subjects ─────────────────────────────────────────────────────

const SUBJECT_TINTS = ['lhx-tint-green', 'lhx-tint-blue', 'lhx-tint-pink', 'lhx-tint-orange', 'lhx-tint-purple']
const SUBJECT_TONES = ['var(--lhx-green)', 'var(--lhx-blue)', 'var(--lhx-pink)', 'var(--lhx-orange)', 'var(--lhx-purple)']

export function MySubjectsSection({ subjects, activeTerm, loading }) {
  const navigate = useNavigate()
  // With the Learn tab retired (step 5), Home IS the subjects list — every
  // subject with material renders here, so there is no "View all" to link.
  const withMaterial = (subjects || []).filter((s) => s.hasMaterial)
  const rows = withMaterial.length ? withMaterial : subjects || []

  return (
    <section className="lhx-section" aria-labelledby="lhx-subjects-title">
      <div className="lhx-section-head">
        <h2 id="lhx-subjects-title" className="lhx-section-title">My subjects</h2>
        {activeTerm && <span className="lhx-view-all" aria-hidden="true">Term {activeTerm}</span>}
      </div>
      {loading ? (
        <SectionSkeleton lines={4} height={56} />
      ) : rows.length === 0 ? (
        <div className="lhx-card"><EmptyState icon="learn">Your subjects will appear here once your grade is set.</EmptyState></div>
      ) : (
        <div className="lhx-subjects">
          {rows.map((s, i) => (
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
