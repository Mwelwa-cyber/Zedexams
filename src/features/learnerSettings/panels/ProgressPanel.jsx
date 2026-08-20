// Progress & Performance — the detail view. Real gamification stats + recent
// results drive XP/level, streak, quiz average, question count and per-subject
// strengths; deterministic insight lines add honest nudges. Unlocking a new
// badge fires confetti (reduced-motion aware). No AI call anywhere.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useBadges } from '../../../hooks/useBadges'
import { SkeletonCard } from '../../../shared/components/Skeleton'
import { Panel, Section, ProgressRing, Btn, Note, StatTile } from '../components/ui'
import { FireIcon, TrophyIcon, CheckCircleIcon, BookOpen, BarChart3 } from '../../../shared/components/icons'
import useProgressData, { subjectLabel } from '../lib/useProgressData'
import { downloadMyData } from './AccountPanel'
import Confetti from '../components/Confetti'

const SEEN_KEY = 'zedexams:learnerSettings:seenBadges:v1'

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() }
}
function writeSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])) } catch { /* private mode */ }
}

export default function ProgressPanel({ section, pushToast }) {
  const { userProfile, currentUser } = useAuth()
  const navigate = useNavigate()
  const { loading, derived, insights, level, streak, examsCompleted, grade } = useProgressData()
  const { earned } = useBadges(currentUser?.uid)

  // Fire confetti the first time a brand-new badge appears (vs. what we've seen).
  const [confettiKey, setConfettiKey] = useState(0)
  const seededRef = useRef(false)
  useEffect(() => {
    if (!earned?.length) return
    const seen = readSeen()
    const ids = earned.map((b) => b.id).filter(Boolean)
    const fresh = ids.filter((id) => !seen.has(id))
    // On first load just seed the seen-set (don't celebrate history); afterwards
    // any newly-earned badge celebrates.
    if (!seededRef.current) {
      seededRef.current = true
      writeSeen(new Set(ids))
      return
    }
    if (fresh.length) {
      setConfettiKey((k) => k + 1)
      writeSeen(new Set(ids))
    }
  }, [earned])

  const xpPct = useMemo(() => {
    const p = Number(level?.progress)
    return Number.isFinite(p) ? Math.round(p * (p <= 1 ? 100 : 1)) : 0
  }, [level])

  if (loading) {
    return (
      <Panel section={section}>
        <SkeletonCard />
      </Panel>
    )
  }

  return (
    <Panel section={section}>
      <Confetti fireKey={confettiKey} />

      <Section title="At a glance" hint="Based on your recent quizzes and exams.">
        <div className="lset-progress-rings" style={{ marginBottom: 18 }}>
          <ProgressRing value={derived.average} sublabel="Quiz average" />
          <ProgressRing value={Math.min(100, streak * 10)} label={String(streak)} sublabel="Day streak" />
          <ProgressRing value={xpPct} label={`Lv ${level?.level ?? 1}`} sublabel={level?.title || 'Level'} />
        </div>
        <div className="lset-stattiles">
          <StatTile emoji="🎓" value={grade ? `G${grade}` : '—'} label="Current grade" tone="#2563eb" animate={false} />
          <StatTile icon={BarChart3} value={derived.average} label="Average score" tone="#7c3aed" format={(n) => `${Math.round(n)}%`} />
          <StatTile icon={BookOpen} value={derived.questionsAnswered} label="Questions answered" tone="#0ea5e9" />
          <StatTile icon={FireIcon} value={streak} label="Learning streak" tone="#f59e0b" />
          <StatTile icon={CheckCircleIcon} value={derived.weakCount} label="Weak topics" tone="#ef4444" />
          <StatTile icon={TrophyIcon} value={derived.strongCount} label="Strong topics" tone="#22c55e" />
        </div>
      </Section>

      {insights.length > 0 && (
        <Section title="Smart insights" hint="Little nudges from your own results.">
          <div className="lset-insights">
            {insights.map((ins, i) => (
              <div key={i} className="lset-insight" style={{ '--tone': ins.tone }}>
                <span className="lset-insight__emoji" aria-hidden="true">{ins.emoji}</span>
                <span>{ins.text}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Strengths & focus areas">
        <div className="lset-stats">
          <div className="lset-stat">
            <div className="lset-stat__value">{derived.strongest ? subjectLabel(derived.strongest.subject) : '—'}</div>
            <div className="lset-stat__label">Strongest subject</div>
          </div>
          <div className="lset-stat">
            <div className="lset-stat__value">{derived.weakest ? subjectLabel(derived.weakest.subject) : '—'}</div>
            <div className="lset-stat__label">Needs practice</div>
          </div>
          <div className="lset-stat">
            <div className="lset-stat__value">{examsCompleted}</div>
            <div className="lset-stat__label">Exams completed</div>
          </div>
          <div className="lset-stat">
            <div className="lset-stat__value">{level?.level ?? 1}</div>
            <div className="lset-stat__label">Level · {(level?.title) || '—'}</div>
          </div>
        </div>
      </Section>

      {derived.testsCompleted === 0 && (
        <Note tone="accent">💡 Take your first quiz to start building your progress picture.</Note>
      )}

      {/* /my-stats and /my-badges were retired (2026-08-20); their content
          lives on /progress and /profile. This panel is not currently
          mounted by any learner route — LearnerSettingsRoute renders the
          settings screens `bare`, and the card grid this belongs to is not
          in the learner mockup — so these were dead buttons at dead routes.
          The one action with something behind it stays. */}
      <div className="lset-actions">
        <Btn onClick={() => navigate('/progress')}>📊 View full analytics</Btn>
        <Btn variant="ghost" onClick={() => downloadMyData(currentUser, userProfile, pushToast)}>⬇ Download progress report</Btn>
        <Btn variant="ghost" onClick={() => navigate('/profile')}>🏅 My badges</Btn>
      </div>
    </Panel>
  )
}
