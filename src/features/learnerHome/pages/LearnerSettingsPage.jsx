// src/features/learnerHome/pages/LearnerSettingsPage.jsx
//
// /settings for learners — the prototype-v7 Settings screen (learner
// redesign step 11), rendered inside the learner shell so the four-tab
// nav stays visible, exactly as the mockup keeps it.
//
// The mockup's shape: grouped cards (Appearance · Notifications ·
// Learning · Account · Privacy & safety) of icon rows, each row either a
// real switch or a tap-through with its current value, and the version
// footer.
//
// Every switch drives a preference that something actually reads:
//   Night mode        → ThemeContext ('midnight'), the SAME control as
//                       the topbar's 🌙 toggle, so the two can never
//                       disagree — the mockup's syncNight() in one line.
//   Sound & effects   → learningPrefs.soundEffects
//   Push              → notificationPrefs.channels.push
//   Study reminders   → notificationPrefs.categories.learning
//   Exam & results    → notificationPrefs.categories.assessments
//   Quiet hours       → notificationPrefs.quietHours.enabled
//   Ask Zed           → learningPrefs.askZed, overridden by the
//                       guardian's control (read-only + explained here)
//
// Two of the mockup's rows are deliberately NOT built:
//   • "Challenge invites" — ZedExams has no learner-to-learner challenge
//     to be invited to. The duel opponent is Zed, a robot, and there is
//     no child-to-child surface anywhere in the product by design. A
//     switch that gates nothing teaches a parent the wrong thing about
//     what their child can receive.
//   • "Daily study reminder at 17:00" as its own switch — the server's
//     notification model has categories, not one row per message, so
//     daily practice and streak nudges are one honest row rather than
//     two switches writing the same field.
//
// Deep-link rows land on the existing detail panels (/settings?section=…),
// which keeps every editor the old settings dashboard owns — name &
// avatar, help & reporting, account deletion — reachable and unchanged.

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import { useTheme, DEFAULT_THEME } from '../../../contexts/ThemeContext'
import { normalizeNotificationPrefs } from '../../../engines/notification-engine/notificationPrefs'
import { normalizeLearningPrefs, DAILY_GOAL_OPTIONS } from '../../learnerSettings'
import { resolveLearnerAccess } from '../../../utils/guardianConsent'
import { readGuardianControls } from '../../../utils/guardianControls'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import LearnerShell from '../components/LearnerShell'

const LAST_LIGHT_KEY = 'lhx:last-light-theme'
const CHILDLINE = '116'
// The build stamps VITE_APP_VERSION (see utils/releaseName.js). A dev
// build has none, and a footer is not worth a crash — so it degrades to
// the name rather than printing "vundefined".
const APP_VERSION = import.meta.env?.VITE_APP_VERSION || null

/* ── Row primitives (prototype .set-group / .set-row) ──────────── */

function Group({ title, children }) {
  return (
    <>
      <h2 className="lhx-set-head">{title}</h2>
      <div className="lhx-set-group">{children}</div>
    </>
  )
}

function SwitchRow({ icon, title, desc, checked, onChange, disabled = false }) {
  return (
    <div className="lhx-set-row">
      <span className="lhx-set-ic" aria-hidden="true">{icon}</span>
      <span className="lhx-set-txt">
        <span className="lhx-set-title">{title}</span>
        {desc && <span className="lhx-set-desc">{desc}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="lhx-switch"
      />
    </div>
  )
}

function LinkRow({ icon, title, desc, value, onClick, danger = false }) {
  return (
    <button type="button" className={`lhx-set-row lhx-set-tap${danger ? ' lhx-set-danger' : ''}`} onClick={onClick}>
      <span className="lhx-set-ic" aria-hidden="true">{icon}</span>
      <span className="lhx-set-txt">
        <span className="lhx-set-title">{title}</span>
        {desc && <span className="lhx-set-desc">{desc}</span>}
      </span>
      {value && <span className="lhx-set-val">{value}</span>}
      <span className="lhx-set-chev" aria-hidden="true">›</span>
    </button>
  )
}

export default function LearnerSettingsPage() {
  const { userProfile, updateProfileFields } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const stored = useMemo(() => ({
    learning: normalizeLearningPrefs(userProfile?.learningPrefs),
    notify: normalizeNotificationPrefs(userProfile?.notificationPrefs),
  }), [userProfile?.learningPrefs, userProfile?.notificationPrefs])

  // Optimistic overlay: a switch must move under the thumb immediately,
  // but the profile snapshot only lands after the write round-trips.
  const [pending, setPending] = useState({})
  const val = (path, fallback) => (path in pending ? pending[path] : fallback)

  const save = useCallback(async (path, value, patch) => {
    setPending((p) => ({ ...p, [path]: value }))
    try {
      await updateProfileFields(patch)
    } catch {
      // Firestore queues offline writes and replays them, so a failure
      // here is a real one — drop the overlay and let the stored value
      // show through rather than leaving a switch lying about state.
      setPending((p) => { const next = { ...p }; delete next[path]; return next })
    }
  }, [updateProfileFields])

  const night = theme === 'midnight'
  const toggleNight = (on) => {
    if (!on) {
      let last = null
      try { last = window.localStorage.getItem(LAST_LIGHT_KEY) } catch { /* private mode */ }
      setTheme(last && last !== 'midnight' ? last : DEFAULT_THEME)
    } else {
      try { window.localStorage.setItem(LAST_LIGHT_KEY, theme) } catch { /* private mode */ }
      setTheme('midnight')
    }
  }

  const setLearning = (key, value) =>
    save(`learning.${key}`, value, { learningPrefs: { ...stored.learning, [key]: value } })
  const setCategory = (key, value) =>
    save(`notify.cat.${key}`, value, {
      notificationPrefs: { ...stored.notify, categories: { ...stored.notify.categories, [key]: value } },
    })
  const setChannel = (key, value) =>
    save(`notify.ch.${key}`, value, {
      notificationPrefs: { ...stored.notify, channels: { ...stored.notify.channels, [key]: value } },
    })
  const setQuiet = (value) =>
    save('notify.quiet', value, {
      notificationPrefs: { ...stored.notify, quietHours: { ...stored.notify.quietHours, enabled: value } },
    })

  // Same test the profile hero uses for its Guardian-verified chip.
  const guardianApproved = resolveLearnerAccess(userProfile).reason === 'guardian-approved'
  const controls = readGuardianControls(userProfile)
  const goal = DAILY_GOAL_OPTIONS.find((o) => o.value === stored.learning.dailyGoal)
  const quiet = stored.notify.quietHours
  const firstName = String(userProfile?.displayName || '').trim().split(/\s+/)[0] || null

  return (
    <LearnerShell>
      <SeoHelmet title="Settings · ZedExams" noindex />

      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to My Profile" onClick={() => navigate('/profile')}>‹</button>
        <h1 className="lhx-back-title">Settings</h1>
      </div>

      <Group title="Appearance">
        <SwitchRow
          icon="🌙" title="Night mode" desc="Easier on the eyes at night"
          checked={night} onChange={toggleNight}
        />
        <SwitchRow
          icon="🔊" title="Sound &amp; effects" desc="Taps and correct/wrong sounds"
          checked={val('learning.soundEffects', stored.learning.soundEffects)}
          onChange={(v) => setLearning('soundEffects', v)}
        />
      </Group>

      <Group title="Notifications">
        <SwitchRow
          icon="📲" title="Push notifications" desc="Alerts on your phone"
          checked={val('notify.ch.push', stored.notify.channels.push)}
          onChange={(v) => setChannel('push', v)}
        />
        <SwitchRow
          icon="⏰" title="Study reminders" desc="Daily practice and your streak"
          checked={val('notify.cat.learning', stored.notify.categories.learning)}
          onChange={(v) => setCategory('learning', v)}
        />
        <SwitchRow
          icon="📅" title="Exam &amp; results alerts" desc="Papers coming up, and your marks"
          checked={val('notify.cat.assessments', stored.notify.categories.assessments)}
          onChange={(v) => setCategory('assessments', v)}
        />
        <SwitchRow
          icon="🌙" title="Quiet hours" desc={`No alerts ${quiet.start} – ${quiet.end}`}
          checked={val('notify.quiet', quiet.enabled)}
          onChange={setQuiet}
        />
      </Group>

      <Group title="Learning">
        <SwitchRow
          icon="🤖" title="Ask Zed"
          desc={controls.askZed === false
            ? 'Turned off by your guardian'
            : 'Your study helper (online only)'}
          checked={controls.askZed === false ? false : val('learning.askZed', stored.learning.askZed)}
          disabled={controls.askZed === false}
          onChange={(v) => setLearning('askZed', v)}
        />
        <LinkRow
          icon="🎯" title="Daily goal" value={goal ? goal.label : `${stored.learning.dailyGoal} min`}
          onClick={() => navigate('/settings?section=learning')}
        />
      </Group>

      <Group title="Account">
        <LinkRow
          icon="🙂" title="Name &amp; avatar" value={firstName}
          onClick={() => navigate('/settings?section=account')}
        />
        {/* The zone is only offered where it means something: an account
            with an approved guardian. Offering a "Guardian Zone" on an
            account with no guardian would promise a parent a dashboard
            that has nobody behind it. */}
        {guardianApproved && (
          <LinkRow
            icon="🛡️" title="Guardian Zone" desc="Progress &amp; parent controls" value="✅"
            onClick={() => navigate('/guardian')}
          />
        )}
        <LinkRow
          icon="⬇️" title="Downloads &amp; storage" desc="Offline papers and notes"
          onClick={() => navigate('/offline')}
        />
      </Group>

      <Group title="Privacy &amp; safety">
        <LinkRow
          icon="🚩" title="Report a problem"
          onClick={() => navigate('/settings?section=help')}
        />
        {/* Childline is a phone call, not a page — a child in trouble
            should reach a person, so this dials rather than navigating. */}
        <a className="lhx-set-row lhx-set-tap" href={`tel:${CHILDLINE}`}>
          <span className="lhx-set-ic" aria-hidden="true">☎️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Get help</span>
            <span className="lhx-set-desc">Childline Zambia · {CHILDLINE}</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </a>
        <LinkRow
          icon="🗑️" title="Delete account" desc="Guardian approval required" danger
          onClick={() => navigate('/settings?section=account')}
        />
      </Group>

      <p className="lhx-set-footer">
        {['ZedExams', APP_VERSION ? `v${APP_VERSION}` : null, 'Made for Zambian learners 🇿🇲']
          .filter(Boolean).join(' · ')}
      </p>
    </LearnerShell>
  )
}
