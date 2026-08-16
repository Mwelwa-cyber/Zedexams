/**
 * The compact home sections: Quick Access, My Subjects, Recommended,
 * Daily Game Challenge, Recent Activity and the Achievements summary.
 * All data arrives pre-shaped from useLearnerDashboard — these render
 * only (spec §18: no per-card queries).
 */
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import LearnerIcon, { subjectIconName } from '../components/LearnerIcon'
import { ProgressBar, EmptyState, SectionSkeleton } from '../components/LearnerPrimitives'
import { relativeTime } from '../lib/learnerHomeCore'
import { capture } from '../../../utils/analytics'

// ── Quick Access ────────────────────────────────────────────────────

// Learn + Practice retired (redesign step 5) — the cards deep-link the
// libraries and the quiz list directly instead of going through tabs.
const QUICK_ITEMS = [
  { icon: 'lessons', title: 'Lessons', label: 'Learn', to: '/lessons', tint: 'lhx-tint-purple' },
  { icon: 'notes', title: 'Notes', label: 'Read', to: '/notes', tint: 'lhx-tint-green' },
  { icon: 'papers', title: 'Past Papers', label: 'ECZ', to: '/papers', tint: 'lhx-tint-orange' },
  { icon: 'quiz', title: 'Quizzes', label: 'Practice', to: '/quizzes', tint: 'lhx-tint-blue' },
]

export function QuickAccessGrid() {
  const navigate = useNavigate()
  return (
    <section className="lhx-section" aria-labelledby="lhx-quick-title">
      <div className="lhx-section-head">
        <h2 id="lhx-quick-title" className="lhx-section-title">Quick Access</h2>
      </div>
      <div className="lhx-quick">
        {QUICK_ITEMS.map((item) => (
          <button
            key={item.title}
            type="button"
            className="lhx-quick-card lhx-press"
            aria-label={`${item.title} — ${item.label}`}
            onClick={() => navigate(item.to)}
          >
            <span className={`lhx-quick-icon ${item.tint}`} aria-hidden="true">
              <LearnerIcon name={item.icon} size={22} />
            </span>
            <span className="lhx-quick-title">{item.title}</span>
            <span className="lhx-quick-label">{item.label}</span>
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
  // With the Learn tab retired (step 5), Home IS the subjects list — every
  // subject with material renders here, so there is no "View all" to link.
  const withMaterial = (subjects || []).filter((s) => s.hasMaterial)
  const rows = withMaterial.length ? withMaterial : subjects || []

  return (
    <section className="lhx-section" aria-labelledby="lhx-subjects-title">
      <div className="lhx-section-head">
        <h2 id="lhx-subjects-title" className="lhx-section-title">My Subjects</h2>
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

// ── Recommended for You ─────────────────────────────────────────────

export function RecommendationsSection({ recommendations, loading }) {
  const navigate = useNavigate()
  if (!loading && (!recommendations || recommendations.length === 0)) return null

  const open = (rec) => {
    capture('recommendation_started', { kind: rec.kind, id: rec.id })
    if (rec.kind === 'practice') {
      // Practice tab retired (step 5) — a practice nudge opens the quiz
      // list, whose subject cards carry the drill-down.
      navigate('/quizzes')
    } else if (rec.kind === 'note') {
      navigate(`/notes/${rec.targetId}`)
    } else if (rec.kind === 'lesson') {
      navigate(`/lessons/${rec.targetId}`)
    } else if (rec.kind === 'quiz') {
      navigate(`/quiz/${rec.targetId}`)
    } else {
      navigate('/dashboard')
    }
  }

  return (
    <section className="lhx-section" aria-labelledby="lhx-rec-title">
      <div className="lhx-section-head">
        <h2 id="lhx-rec-title" className="lhx-section-title">Recommended for You</h2>
      </div>
      <div className="lhx-card">
        {loading ? (
          <SectionSkeleton lines={3} />
        ) : (
          recommendations.map((rec) => (
            <button key={rec.id} type="button" className="lhx-rec lhx-press" style={{ width: '100%', textAlign: 'left' }} onClick={() => open(rec)}>
              <span className={`lhx-quick-icon ${rec.kind === 'practice' ? 'lhx-tint-orange' : 'lhx-tint-purple'}`} aria-hidden="true">
                <LearnerIcon name={rec.kind === 'practice' ? 'practice' : rec.kind === 'note' ? 'notes' : 'quiz'} size={20} />
              </span>
              <span className="lhx-rec-body">
                <span className="lhx-rec-title" style={{ display: 'block' }}>{rec.title}</span>
                {rec.subjectLabel && <span className="lhx-rec-meta" style={{ display: 'block' }}>{rec.subjectLabel}</span>}
                <span className="lhx-rec-reason" style={{ display: 'block' }}>{rec.reason}</span>
              </span>
              <ChevronRight size={18} className="lhx-chevron" aria-hidden="true" />
            </button>
          ))
        )}
      </div>
    </section>
  )
}

// ── Daily Game Challenge ────────────────────────────────────────────

export function DailyGameChallengeCard({ challenge }) {
  const navigate = useNavigate()
  const game = challenge?.game || challenge
  if (!game || !game.id) return null

  return (
    <section className="lhx-card lhx-game-card" aria-labelledby="lhx-game-title">
      <img
        className="lhx-game-art"
        src="/assets/learner/illustrations/games.webp"
        alt=""
        width="72"
        height="72"
        loading="lazy"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="lhx-kicker">Daily Game Challenge</p>
        <p id="lhx-game-title" className="lhx-rec-title" style={{ marginTop: 3 }}>{game.title || 'Today’s challenge'}</p>
        {(game.subject || game.grade) && (
          <p className="lhx-rec-meta">
            {[game.subject, game.grade ? `Grade ${game.grade}` : null].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
      <button
        type="button"
        className="lhx-btn lhx-btn-sm lhx-btn-primary"
        onClick={() => {
          // NOT `game_started` — this is a NAVIGATION out of the dashboard, and
          // the learner may never press Start once the play surface loads.
          // `game_started` is now emitted by each game engine's start(), once
          // per round, so that it pairs 1:1 with `game_completed`; firing it
          // here as well would double-count every dashboard-originated play
          // and make abandonment look better than it is. Kept as its own event
          // so the dashboard-attribution signal this had is not lost.
          capture('game_challenge_opened', { gameId: game.id, from: 'dashboard_challenge' })
          navigate(`/games/play/${game.id}`)
        }}
      >
        Play
      </button>
    </section>
  )
}

// ── Recent Activity ─────────────────────────────────────────────────

const ACTIVITY_TINTS = {
  quiz_completed: 'lhx-tint-blue',
  daily_exam_completed: 'lhx-tint-green',
  notes_opened: 'lhx-tint-purple',
  notes_completed: 'lhx-tint-purple',
  lesson_opened: 'lhx-tint-purple',
  lesson_completed: 'lhx-tint-green',
  paper_opened: 'lhx-tint-orange',
}

export function RecentActivitySection({ recentActivity, loading }) {
  const navigate = useNavigate()
  const now = Date.now()

  return (
    <section className="lhx-section" aria-labelledby="lhx-activity-title">
      <div className="lhx-section-head">
        <h2 id="lhx-activity-title" className="lhx-section-title">Recent Activity</h2>
        <button type="button" className="lhx-view-all" onClick={() => navigate('/my-results')}>
          View all <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="lhx-card lhx-activity">
        {loading ? (
          <SectionSkeleton lines={3} height={40} />
        ) : !recentActivity || recentActivity.length === 0 ? (
          <EmptyState icon="progress">
            Your completed lessons, quizzes and papers will appear here.
          </EmptyState>
        ) : (
          recentActivity.map((item) => (
            <button
              key={`${item.type}-${item.attemptId || item.sourceId}-${item.completedAt}`}
              type="button"
              className="lhx-activity-item"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => item.href && navigate(item.href)}
            >
              <span className={`lhx-activity-icon ${ACTIVITY_TINTS[item.type] || 'lhx-tint-purple'}`} aria-hidden="true">
                <LearnerIcon name={item.icon || 'progress'} size={18} />
              </span>
              <span className="lhx-activity-main">
                <span className="lhx-activity-title" style={{ display: 'block' }}>{item.title}</span>
                <span className="lhx-activity-meta" style={{ display: 'block' }}>
                  {[item.subjectLabel, relativeTime(item.completedAt, now)].filter(Boolean).join(' · ')}
                </span>
              </span>
              {item.score != null && <span className="lhx-activity-score">{item.score}%</span>}
            </button>
          ))
        )}
      </div>
    </section>
  )
}

// ── Achievements summary (compact, optional) ────────────────────────

export function AchievementsSummary({ streak, xp }) {
  const navigate = useNavigate()
  if (!streak && !xp) return null
  return (
    <section className="lhx-card" aria-label="Achievements summary">
      <button
        type="button"
        className="lhx-activity-item"
        style={{ width: '100%', textAlign: 'left', padding: 0, minHeight: 0 }}
        onClick={() => navigate('/my-badges')}
      >
        <span className="lhx-activity-icon lhx-tint-orange" aria-hidden="true">
          <LearnerIcon name="trophy" size={18} />
        </span>
        <span className="lhx-activity-main">
          <span className="lhx-activity-title" style={{ display: 'block' }}>My Achievements</span>
          <span className="lhx-activity-meta" style={{ display: 'block' }}>
            {[streak ? `${streak}-day streak` : null, xp ? `${xp} XP` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <ChevronRight size={18} className="lhx-chevron" aria-hidden="true" />
      </button>
    </section>
  )
}
