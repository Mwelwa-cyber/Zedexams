// Overview dashboard cards — the summary tiles that make up the redesigned
// Settings landing (mockup-faithful). Each card shows the highest-value controls
// for its section and a "Manage all / More" drill-in (onOpen) to the full detail
// panel. Every editable control routes through the SaveContext commit() → the
// same autosave path the detail panels use, so nothing here writes Firestore
// directly. Read-only figures come from real hooks.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { useTheme, DEFAULT_THEME } from '../../../contexts/ThemeContext'
import { useSettingsSave } from './SaveContext'
import Icon from '../../../shared/components/Icon'
import CharacterAvatar from '../../../shared/components/CharacterAvatar'
import { UpgradeModal } from '../../subscription'
import { mayShowPrice } from '../../../services/entitlements/planState'
import { SkeletonCard } from '../../../shared/components/Skeleton'
import {
  SectionCard, StatTile, Segmented, LinkRow, Toggle, Select, Btn,
} from './ui'
import {
  User, BookOpen, BarChart3, Bell, SwatchIcon, Eye, Sparkles, TrophyIcon,
  ShieldCheck, Info, Key, LogOut, Mail, AlertTriangle, Lightbulb, Play,
  FireIcon, CheckCircleIcon, Camera,
} from '../../../shared/components/icons'
import {
  normalizeLearningPrefs, DAILY_GOAL_OPTIONS, LANGUAGE_OPTIONS,
  normalizeReminderPrefs, normalizePersonalisation, ACCENT_OPTIONS,
} from '../lib/learnerPrefs'
import { useA11y, updateA11y } from '../lib/useA11y'
import useProgressData from '../lib/useProgressData'

// Small local icon helper so the cards stay terse.
function Icon2({ as }) { return <Icon as={as} size="sm" strokeWidth={2.2} /> }

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'adaptive', label: 'Automatic (AI)' },
]

/* ── 1. My Account ────────────────────────────────────────────── */
export function MyAccountCard({ onOpen }) {
  const { userProfile, currentUser } = useAuth()
  const name = userProfile?.displayName || 'Learner'
  const initials = name.slice(0, 2).toUpperCase()
  const username = userProfile?.preferredName || (currentUser?.email ? currentUser.email.split('@')[0] : '—')
  const phone = userProfile?.phone
    || userProfile?.learnerSettings?.security?.recoveryPhone
    || userProfile?.learnerSettings?.parent?.phone
    || '—'
  const fields = [
    ['Full Name', name],
    ['Username', username],
    ['Grade', userProfile?.grade ? `Grade ${userProfile.grade}` : '—'],
    ['Email', currentUser?.email || '—'],
    ['Phone', phone],
    ['School', userProfile?.school || '—'],
  ]
  return (
    <SectionCard
      id="sec-account" tone="blue" icon={User}
      title="My Account" subtitle="Personal information and security"
      headerRight={<Btn size="sm" onClick={() => onOpen('account')}>Edit Profile</Btn>}
    >
      <div className="lset-profilecard">
        <div className="lset-profilecard__avatarwrap">
          <div className="lset-profilecard__avatar">
            {userProfile?.avatarPhotoUrl
              ? <img src={userProfile.avatarPhotoUrl} alt="" />
              : userProfile?.avatarCharacter
                ? <CharacterAvatar characterId={userProfile.avatarCharacter} className="w-full h-full" />
                : initials}
          </div>
          <button type="button" className="lset-profilecard__cam" onClick={() => onOpen('account')} aria-label="Edit photo">
            <Icon2 as={Camera} />
          </button>
        </div>
        <div className="lset-profilecard__fields">
          {fields.map(([k, v]) => (
            <div key={k} className="lset-kv">
              <div className="lset-kv__k">{k}</div>
              <div className="lset-kv__v">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="lset-strip">
        <div className="lset-strip__text">
          <p className="lset-strip__title">Change Password</p>
          <p className="lset-strip__hint">Keep your account secure with a strong password.</p>
        </div>
        <Btn variant="ghost" size="sm" onClick={() => onOpen('security')}>Change Password →</Btn>
      </div>
    </SectionCard>
  )
}

/* ── 2. Learning Preferences ──────────────────────────────────── */
export function LearningCard({ onOpen }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const lp = normalizeLearningPrefs(userProfile?.learningPrefs)
  const setLp = (key, value) => commit({ learningPrefs: { ...lp, [key]: value } })

  return (
    <SectionCard
      id="sec-learning" tone="purple" icon={BookOpen}
      title="Learning Preferences" subtitle="Study goals and learning options"
      more="Manage all learning options" onMore={() => onOpen('learning')}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div>
          <span className="lset-fieldlabel">Preferred language</span>
          <Select
            value={userProfile?.preferredLanguage ?? 'en'}
            onChange={(v) => commit({ preferredLanguage: v })}
            options={LANGUAGE_OPTIONS}
          />
        </div>
        <Segmented
          label="Daily learning goal"
          options={DAILY_GOAL_OPTIONS}
          value={lp.dailyGoal}
          onChange={(v) => setLp('dailyGoal', v)}
        />
        <Segmented
          label="Difficulty"
          options={DIFFICULTY_OPTIONS}
          value={lp.quizDifficulty}
          onChange={(v) => setLp('quizDifficulty', v)}
        />
        <div>
          <Toggle title="Enable AI Tutor" hint="Get hints and explanations from AI." checked={lp.showHints} onChange={(v) => setLp('showHints', v)} />
          <Toggle title="Voice reading" hint="Read questions and notes aloud." checked={lp.textToSpeech} onChange={(v) => setLp('textToSpeech', v)} />
          <Toggle title="Timed quizzes" hint="Add a countdown to your practice." checked={lp.timedQuizzes} onChange={(v) => setLp('timedQuizzes', v)} />
        </div>
      </div>
    </SectionCard>
  )
}

/* ── 3. Progress & Performance ────────────────────────────────── */
export function ProgressCard({ onOpen }) {
  const navigate = useNavigate()
  const { loading, derived, streak, grade } = useProgressData()

  if (loading) {
    return (
      <SectionCard id="sec-progress" tone="green" icon={BarChart3} title="Progress & Performance" subtitle="View your stats and learning progress">
        <SkeletonCard />
      </SectionCard>
    )
  }
  return (
    <SectionCard
      id="sec-progress" tone="green" icon={BarChart3}
      title="Progress & Performance" subtitle="View your stats and learning progress"
    >
      <div className="lset-stattiles">
        <StatTile emoji="🎓" value={grade ? `G${grade}` : '—'} label="Current Grade" tone="#2563eb" animate={false} />
        <StatTile icon={BarChart3} value={derived.average} label="Average Score" tone="#7c3aed" format={(n) => `${Math.round(n)}%`} />
        <StatTile icon={BookOpen} value={derived.questionsAnswered} label="Questions Answered" tone="#0ea5e9" />
        <StatTile icon={FireIcon} value={streak} label="Learning Streak" tone="#f59e0b" />
        <StatTile icon={CheckCircleIcon} value={derived.weakCount} label="Weak Topics" tone="#ef4444" />
        <StatTile icon={TrophyIcon} value={derived.strongCount} label="Strong Topics" tone="#22c55e" />
      </div>
      <div className="lset-actions">
        {/* /my-stats was retired (2026-08-20) — /progress carries it. */}
        <Btn onClick={() => navigate('/progress')}>📊 View Detailed Analytics</Btn>
        <Btn variant="ghost" onClick={() => onOpen('progress')}>⬇ Download Progress Report</Btn>
      </div>
    </SectionCard>
  )
}

/* ── 4. Notifications ─────────────────────────────────────────── */
const NOTIF_ROWS = [
  { key: 'dailyPractice', label: 'Daily quiz available' },
  { key: 'homework', label: 'Homework reminders' },
  { key: 'assignedWork', label: 'Assignment reminders' },
  { key: 'weeklyStudy', label: 'Weekly progress report' },
  { key: 'upcomingExams', label: 'Exam reminders' },
  { key: 'results', label: 'New results' },
  { key: 'badges', label: 'Achievement badges' },
  { key: 'leaderboard', label: 'Leaderboard updates' },
]
export function NotificationsCard({ onOpen }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const n = normalizeReminderPrefs(userProfile?.learnerSettings?.notifications)
  const setItem = (key, value) => {
    const next = normalizeReminderPrefs(userProfile?.learnerSettings?.notifications)
    next.items[key] = value
    commit({ 'learnerSettings.notifications': next })
  }
  return (
    <SectionCard
      id="sec-notifications" tone="orange" icon={Bell}
      title="Notifications" subtitle="Manage your notifications"
      more="Manage all notifications" onMore={() => onOpen('notifications')}
    >
      {NOTIF_ROWS.map((row) => (
        <Toggle key={row.key} title={row.label} checked={n.items[row.key]} onChange={(v) => setItem(row.key, v)} />
      ))}
    </SectionCard>
  )
}

/* ── 5. Appearance ────────────────────────────────────────────── */
const FONT_SEG = [{ value: 'small', label: 'A−' }, { value: 'medium', label: 'A' }, { value: 'large', label: 'A+' }]
export function AppearanceCard({ onOpen }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const { theme, setTheme } = useTheme()
  const a11y = useA11y()
  const ps = normalizePersonalisation(userProfile?.learnerSettings?.personalisation)

  const isDark = theme === 'midnight'
  const setMode = (mode) => {
    let dark = isDark
    if (mode === 'light') dark = false
    else if (mode === 'dark') dark = true
    else if (mode === 'system') {
      try { dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches || false } catch { dark = false }
    }
    setTheme(dark ? 'midnight' : DEFAULT_THEME)
    commit({ 'learnerSettings.personalisation': { ...ps, darkMode: dark } })
  }
  const setAccent = (accent) => commit({ 'learnerSettings.personalisation': { ...ps, accent } })
  const setA11yField = (patch) => { const next = updateA11y(patch); commit({ 'learnerSettings.accessibility': next }) }

  return (
    <SectionCard
      id="sec-appearance" tone="blue" icon={SwatchIcon}
      title="Appearance" subtitle="Theme, font size and display"
      more="More display options" onMore={() => onOpen('appearance')}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <Segmented
          label="Theme"
          options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]}
          value={isDark ? 'dark' : 'light'}
          onChange={setMode}
        />
        <div>
          <span className="lset-fieldlabel">Accent colour</span>
          <div className="lset-chips">
            {ACCENT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`lset-chip${ps.accent === o.value ? ' lset-chip--on' : ''}`}
                aria-pressed={ps.accent === o.value}
                onClick={() => setAccent(o.value)}
              >
                <span aria-hidden="true" style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: o.swatch, marginRight: 6, border: '1px solid rgba(0,0,0,.15)' }} />
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <Segmented label="Font size" options={FONT_SEG} value={a11y.fontScale} onChange={(v) => setA11yField({ fontScale: v })} />
        <div>
          <Toggle title="High contrast" checked={a11y.highContrast} onChange={(v) => setA11yField({ highContrast: v })} />
          <Toggle title="Animations" hint="Motion, fades and transitions." checked={!a11y.reducedMotion} onChange={(v) => setA11yField({ reducedMotion: !v })} />
        </div>
      </div>
    </SectionCard>
  )
}

/* ── 6. Accessibility ─────────────────────────────────────────── */
export function AccessibilityCard({ onOpen }) {
  const { userProfile } = useAuth()
  const { commit } = useSettingsSave()
  const a11y = useA11y()
  const lp = normalizeLearningPrefs(userProfile?.learningPrefs)
  const setA11yField = (patch) => { const next = updateA11y(patch); commit({ 'learnerSettings.accessibility': next }) }

  return (
    <SectionCard
      id="sec-accessibility" tone="green" icon={Eye}
      title="Accessibility" subtitle="Tools to support your learning"
      more="More accessibility options" onMore={() => onOpen('accessibility')}
    >
      <Toggle title="Read questions aloud" checked={lp.textToSpeech} onChange={(v) => commit({ learningPrefs: { ...lp, textToSpeech: v } })} />
      <Toggle title="Larger text" checked={a11y.fontScale === 'large'} onChange={(v) => setA11yField({ fontScale: v ? 'large' : 'medium' })} />
      <Toggle title="Dyslexia-friendly font" checked={a11y.dyslexiaFont} onChange={(v) => setA11yField({ dyslexiaFont: v })} />
      <Toggle title="Colour-blind mode" checked={a11y.colorBlind !== 'none'} onChange={(v) => setA11yField({ colorBlind: v ? 'deuteranopia' : 'none' })} />
      <div className="lset-toggle">
        <div className="lset-toggle__text"><p className="lset-toggle__title">Voice answers</p></div>
        <span className="lset-soon">Coming soon</span>
      </div>
    </SectionCard>
  )
}

/* ── 8. Premium ───────────────────────────────────────────────── */
const PREMIUM_BENEFITS = [
  'Unlimited quizzes', 'Unlimited past papers', 'AI Tutor',
  'AI Explanations', 'Performance reports', 'Download worksheets',
]
export function PremiumCard({ onOpen }) {
  const { userProfile } = useAuth()
  const { tierLabel, isPremium } = useSubscription()
  const [showUpgrade, setShowUpgrade] = useState(false)
  const canBuy = !!userProfile && mayShowPrice(userProfile)
  return (
    <section id="sec-premium" className="lset-scard lset-premium">
      <header className="lset-scard__head">
        <span className="lset-scard__tile lset-premium__crown"><Icon2 as={TrophyIcon} /></span>
        <div className="lset-scard__titles">
          <h2 className="lset-scard__title">Premium</h2>
          <p className="lset-scard__sub">Upgrade your plan and benefits</p>
        </div>
      </header>
      <div className="lset-scard__body">
        <div className="lset-premium__plan">
          <div className="lset-premium__planlabel">Current Plan</div>
          <div className="lset-premium__planname">{isPremium ? tierLabel : 'Free'}</div>
        </div>
        <ul className="lset-premium__benefits">
          {PREMIUM_BENEFITS.map((b) => <li key={b} className="lset-premium__benefit">{b}</li>)}
        </ul>
      </div>
      <div className="lset-scard__foot">
        {/* No purchase CTA on a child's screen. `mayShowPrice` fails closed and
            the `!!userProfile` prefix is load-bearing — it reads a MISSING
            profile as an anonymous visitor, right for marketing, wrong here.
            The card still names the current plan above, which is a fact about
            the account rather than an offer. Same shape as AccountPanel.jsx. */}
        {!canBuy
          ? <button type="button" className="lset-btn lset-btn--full" onClick={() => onOpen('premium')}>See plans</button>
          : isPremium
            ? <button type="button" className="lset-btn lset-btn--full lset-btn--gold" onClick={() => onOpen('premium')}>Manage plan</button>
            : <button type="button" className="lset-btn lset-btn--full lset-btn--gold" onClick={() => setShowUpgrade(true)}>👑 Upgrade Now</button>}
      </div>
      {canBuy && showUpgrade && (
        <UpgradeModal portal="learner" defaultPlanId={userProfile?.subscriptionPlan || 'monthly'} onClose={() => setShowUpgrade(false)} />
      )}
    </section>
  )
}

/* ── 9. Security & Privacy ────────────────────────────────────── */
export function SecurityPrivacyCard({ onOpen }) {
  return (
    <SectionCard id="sec-security" tone="blue" icon={ShieldCheck} title="Security & Privacy" subtitle="Password and login settings">
      <div className="lset-linklist">
        <LinkRow icon={Key} title="Change Password" onClick={() => onOpen('security')} />
        <LinkRow icon={ShieldCheck} title="Login Devices" meta="Soon" onClick={() => onOpen('security')} />
        <LinkRow icon={LogOut} title="Sign out of all devices" meta="Soon" onClick={() => onOpen('security')} />
        <LinkRow icon={ShieldCheck} title="Two-factor Authentication" meta="Optional" onClick={() => onOpen('security')} />
      </div>
    </SectionCard>
  )
}

/* ── 10. Help & Support ───────────────────────────────────────── */
export function HelpCard({ onOpen }) {
  const navigate = useNavigate()
  return (
    <SectionCard id="sec-help" tone="slate" icon={Info} title="Help & Support" subtitle="Get help and learn more">
      <div className="lset-linklist">
        <LinkRow icon={Info} title="FAQs" onClick={() => navigate('/pricing')} />
        <LinkRow icon={Mail} title="Contact Support" onClick={() => onOpen('help')} />
        <LinkRow icon={AlertTriangle} title="Report a Problem" onClick={() => onOpen('help')} />
        <LinkRow icon={Lightbulb} title="Send Feedback" onClick={() => onOpen('help')} />
        <LinkRow icon={Play} title="Tutorials" onClick={() => navigate('/lessons')} />
        <LinkRow icon={Sparkles} title="About ZedExams" onClick={() => navigate('/company')} />
      </div>
    </SectionCard>
  )
}
