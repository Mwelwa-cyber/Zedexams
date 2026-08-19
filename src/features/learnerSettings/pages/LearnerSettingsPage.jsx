// src/features/learnerSettings/pages/LearnerSettingsPage.jsx
//
// /settings for learners — the prototype-v6 Settings screen: five
// grouped cards (Appearance · Notifications · Learning · Account ·
// Privacy & safety), real switches, and the version footer. Back goes
// to Profile, exactly as the mockup wires it.
//
// Every control here writes real state — a switch that changed nothing
// would be a lie told in the shape of a setting:
//
//   Night mode          → ThemeContext (midnight IS night)
//   Sound & effects     → learningPrefs.soundEffects
//   Push notifications  → notificationPrefs.channels.push
//   Study reminders     → notificationPrefs.categories.learning
//   Exam reminders      → notificationPrefs.categories.assessments
//   App news            → notificationPrefs.categories.announcements
//   Quiet hours         → notificationPrefs.quietHours.enabled
//   Ask Zed             → learnerSettings.zedAi.enabled (hides the helper)
//   Daily goal          → learningPrefs.dailyGoal
//
// Two rows the mockup draws are NOT here, because the product has no
// such thing and a control that cannot work must not be drawn:
// "Challenge invites" (there is no learner-to-learner challenge — the
// duel races Zed, our robot) and a separate "Streak reminder" (streak
// and daily-practice nudges are one notification category server-side,
// so two switches would silently move the same flag).
//
// The remaining rows navigate into the existing detail panels rather
// than reimplementing flows that carry real weight: Name & avatar and
// Delete account go to the account panel (which holds the LEGAL-003
// re-authentication), Report a problem goes to the help panel's contact
// dialog, Downloads & storage to the offline library.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useTheme, DEFAULT_THEME } from '../../../contexts/ThemeContext'
import { normalizeNotificationPrefs } from '../../../engines/notification-engine/notificationPrefs'
import {
  normalizeLearningPrefs, normalizeZedAiPrefs, DAILY_GOAL_OPTIONS,
} from '../lib/learnerPrefs'
import { resolveLearnerAccess } from '../../../utils/guardianConsent'
import SeoHelmet from '../../../shared/components/SeoHelmet'

const LAST_LIGHT_KEY = 'lhx:last-light-theme'
const CHILDLINE = 'Childline Zambia · 116'

// The learner design system already has one switch — a role="switch"
// button (learnerTheme.css `.lhx-switch`), used by the timetable's
// reminder toggle. Reused rather than duplicated; it now wears the
// mockup's indigo instead of green, since the mockup has no green
// switch anywhere.
function Switch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="lhx-switch"
      onClick={() => onChange(!checked)}
    />
  )
}

function ToggleRow({ icon, title, desc, checked, onChange, disabled }) {
  return (
    <div className="lhx-set-row">
      <span className="lhx-set-ic" aria-hidden="true">{icon}</span>
      <span className="lhx-set-txt">
        <span className="lhx-set-title" style={{ display: 'block' }}>{title}</span>
        {desc && <span className="lhx-set-desc" style={{ display: 'block' }}>{desc}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  )
}

function LinkRow({ icon, title, desc, value, onClick, danger = false }) {
  return (
    <button type="button" className={`lhx-set-row ${danger ? 'lhx-set-danger' : ''}`} onClick={onClick}>
      <span className="lhx-set-ic" aria-hidden="true">{icon}</span>
      <span className="lhx-set-txt">
        <span className="lhx-set-title" style={{ display: 'block' }}>{title}</span>
        {desc && <span className="lhx-set-desc" style={{ display: 'block' }}>{desc}</span>}
      </span>
      {value && <span className="lhx-set-val">{value}</span>}
      <span className="lhx-set-chev" aria-hidden="true">›</span>
    </button>
  )
}

/** Scroll a `?section=` deep link to its group once the page is up. */
function useSectionAnchor() {
  const [params] = useSearchParams()
  const section = params.get('section')
  useEffect(() => {
    const anchor = section ? SECTION_ANCHORS[section] : null
    if (!anchor || typeof document === 'undefined') return
    const el = document.getElementById(anchor)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [section])
}

// The v6 screen is one scrolling page rather than a rail of panels, so a
// `?section=` deep link cannot open a tab here — there are no tabs. It
// scrolls to the matching group instead, which is the same promise kept
// in the shape this screen has. Sections the page does not carry
// (`progress`, `ai`, `premium`, `help`) simply leave the page at the
// top: landing at the top of Settings is a fair answer to "we do not
// have that section", where silently sitting on an unrelated one is not.
const SECTION_ANCHORS = {
  appearance: 'set-appearance',
  notifications: 'set-notifications',
  learning: 'set-learning',
  account: 'set-account',
  security: 'set-security',
}

export default function LearnerSettingsPage() {
  const navigate = useNavigate()
  const { userProfile, updateProfileFields } = useAuth()
  const { theme, setTheme } = useTheme()

  // Optimistic local mirror: the switch moves at once and the write
  // follows, so a slow round-trip never looks like a dead control.
  const [pending, setPending] = useState({})
  const merged = useMemo(() => ({ ...userProfile, ...pending }), [userProfile, pending])

  const notif = useMemo(() => normalizeNotificationPrefs(merged?.notificationPrefs), [merged])
  const learning = useMemo(() => normalizeLearningPrefs(merged?.learningPrefs), [merged])
  const zed = useMemo(() => normalizeZedAiPrefs(merged?.learnerSettings?.zedAi), [merged])
  const guardianGranted = useMemo(
    () => resolveLearnerAccess(userProfile).reason === 'guardian-approved',
    [userProfile],
  )

  const night = theme === 'midnight'
  const version = import.meta.env?.VITE_APP_VERSION || null

  const save = (patch) => {
    setPending((p) => ({ ...p, ...patch }))
    Promise.resolve(updateProfileFields?.(patch)).catch(() => {
      // Roll the mirror back so the switch reflects what is stored.
      setPending((p) => {
        const next = { ...p }
        for (const k of Object.keys(patch)) delete next[k]
        return next
      })
    })
  }

  const setNight = (on) => {
    if (on) {
      try { window.localStorage.setItem(LAST_LIGHT_KEY, theme) } catch { /* private mode */ }
      setTheme('midnight')
      return
    }
    let last = null
    try { last = window.localStorage.getItem(LAST_LIGHT_KEY) } catch { /* private mode */ }
    setTheme(last && last !== 'midnight' ? last : DEFAULT_THEME)
  }

  const setNotif = (patch) => save({ notificationPrefs: { ...notif, ...patch } })
  const setCategory = (key, on) => setNotif({ categories: { ...notif.categories, [key]: on } })

  const goalLabel = DAILY_GOAL_OPTIONS.find((o) => o.value === learning.dailyGoal)?.label
    || `${learning.dailyGoal} min`
  const cycleGoal = () => {
    const i = DAILY_GOAL_OPTIONS.findIndex((o) => o.value === learning.dailyGoal)
    const next = DAILY_GOAL_OPTIONS[(i + 1) % DAILY_GOAL_OPTIONS.length]
    save({ learningPrefs: { ...learning, dailyGoal: next.value } })
  }

  useSectionAnchor()

  return (
    <>
      <SeoHelmet title="Settings" path="/settings" noIndex />
      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to My Profile" onClick={() => navigate('/profile')}>‹</button>
        <div className="lhx-back-title">Settings</div>
      </div>

      <div className="lhx-set-head" id="set-appearance">Appearance</div>
      <div className="lhx-set-group">
        <ToggleRow
          icon="🌙" title="Night mode" desc="Easier on the eyes at night"
          checked={night} onChange={setNight}
        />
        <ToggleRow
          icon="🔊" title="Sound & effects" desc="Taps and correct/wrong sounds"
          checked={learning.soundEffects}
          onChange={(on) => save({ learningPrefs: { ...learning, soundEffects: on } })}
        />
      </div>

      <div className="lhx-set-head" id="set-notifications">Notifications</div>
      <div className="lhx-set-group">
        <ToggleRow
          icon="📲" title="Push notifications" desc="Alerts on your phone"
          checked={notif.channels.push}
          onChange={(on) => setNotif({ channels: { ...notif.channels, push: on } })}
        />
        <ToggleRow
          icon="⏰" title="Study reminders" desc="Daily practice and your streak"
          checked={notif.categories.learning}
          onChange={(on) => setCategory('learning', on)}
        />
        <ToggleRow
          icon="📅" title="Exam reminders" desc="Alerts as your exams get near"
          checked={notif.categories.assessments}
          onChange={(on) => setCategory('assessments', on)}
        />
        <ToggleRow
          icon="📣" title="App news" desc="New features and updates"
          checked={notif.categories.announcements}
          onChange={(on) => setCategory('announcements', on)}
        />
        <ToggleRow
          icon="🌙" title="Quiet hours"
          desc={`No alerts ${notif.quietHours.start} – ${notif.quietHours.end}`}
          checked={notif.quietHours.enabled}
          onChange={(on) => setNotif({ quietHours: { ...notif.quietHours, enabled: on } })}
        />
      </div>

      <div className="lhx-set-head" id="set-learning">Learning</div>
      <div className="lhx-set-group">
        <ToggleRow
          icon="🤖" title="Ask Zed" desc="Your study helper (online only)"
          checked={zed.enabled}
          onChange={(on) => save({
            learnerSettings: { ...(merged?.learnerSettings || {}), zedAi: { ...zed, enabled: on } },
          })}
        />
        <LinkRow icon="🎯" title="Daily goal" value={goalLabel} onClick={cycleGoal} />
      </div>

      <div className="lhx-set-head" id="set-account">Account</div>
      <div className="lhx-set-group">
        <LinkRow
          icon="🙂" title="Name & avatar"
          value={userProfile?.displayName?.split(/\s+/)[0] || null}
          onClick={() => navigate('/settings?section=account')}
        />
        {/* A LinkRow, not an InfoRow. The parent app tells guardians "your
            child finds this in their app under Settings → Guardian", and
            until this row had a destination that sentence was false: the
            family-code panel lived at a section a learner could not reach.
            It is also where a child now answers "is this your grown-up?"
            when somebody redeems their code. */}
        <LinkRow
          icon="🛡️" title="Guardian"
          desc={guardianGranted ? 'Verified · manages approvals' : 'Family code and who can see your progress'}
          value={guardianGranted ? '✅' : null}
          onClick={() => navigate('/settings?section=parent')}
        />
        <LinkRow
          icon="⬇️" title="Downloads & storage" desc="Offline papers and notes"
          onClick={() => navigate('/offline')}
        />
      </div>

      <div className="lhx-set-head" id="set-security">Privacy &amp; safety</div>
      <div className="lhx-set-group">
        <LinkRow icon="🚩" title="Report a problem" onClick={() => navigate('/settings?section=help')} />
        <LinkRow icon="☎️" title="Get help" desc={CHILDLINE} onClick={() => navigate('/settings?section=help')} />
        <LinkRow
          icon="🗑️" title="Delete account" desc="Guardian approval required" danger
          onClick={() => navigate('/settings?section=account')}
        />
      </div>

      <div className="lhx-set-footer">
        ZedExams{version ? ` · v${version}` : ''} · Made for Zambian learners 🇿🇲
      </div>
    </>
  )
}
