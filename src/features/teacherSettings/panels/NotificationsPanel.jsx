import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import {
  NOTIFICATION_CATEGORY_META,
  normalizeNotificationPrefs,
} from '../../../engines/notification-engine/notificationPrefs'
import { isPushSupported, pushPermission, requestPushPermission } from '../../../services/notifications/fcm'
import SettingsDetailShell from '../components/SettingsDetailShell'
import ToggleRow from '../components/fields/ToggleRow'
import { useSettingsSave } from '../lib/useSettingsSave'

// Teacher-flavoured wording for the shared server categories (the keys MUST
// stay the notificationPrefsCore category keys — inventing new ones would
// save silently-dead flags).
const TEACHER_HINTS = {
  learning: 'Quizzes you publish, learner results and weekly reminders.',
  lessonPlans: 'Lesson plans and studio generations — ready, or low on credits.',
  assessments: 'Assessments ready, assigned work and graded results.',
  payments: 'Receipts, renewals and payment issues.',
  account: 'Sign-ins, password changes and security.',
  system: 'Maintenance and important service notices.',
  announcements: 'New features and platform news.',
}

// Notification preferences — same structured users/{uid}.notificationPrefs
// shape as the learner settings page (shared normalizer keeps the two panels
// byte-compatible with the server gate).
export default function NotificationsPanel() {
  const { userProfile, currentUser, updateProfileFields } = useAuth()
  const source = normalizeNotificationPrefs(userProfile?.notificationPrefs)
  const [prefs, setPrefs] = useState(source)
  const [pushState, setPushState] = useState(() => pushPermission())
  const { run, saving, saved, error } = useSettingsSave()

  // Turning push ON is only real once the browser grants permission and an
  // FCM token registers — same flow as the learner settings page. Turning it
  // off just flips the stored pref (we can't revoke a browser grant).
  const onTogglePush = async (push) => {
    if (push && isPushSupported() && pushPermission() !== 'granted' && currentUser?.uid) {
      const result = await requestPushPermission(currentUser.uid)
      setPushState(result)
      if (result !== 'granted') return // pref stays off — nothing would arrive
    }
    setPrefs((p) => ({ ...p, channels: { ...p.channels, push } }))
  }

  const dirty = useMemo(
    () => JSON.stringify(prefs) !== JSON.stringify(source),
    [prefs, source],
  )

  const onSave = () =>
    run(async () => {
      const next = normalizeNotificationPrefs(prefs)
      await updateProfileFields({ notificationPrefs: next })
      setPrefs(next)
    })

  const setCategory = (key) => (on) =>
    setPrefs((p) => ({ ...p, categories: { ...p.categories, [key]: on } }))

  return (
    <SettingsDetailShell
      rowId="notifications"
      saveBar={{ onSave, saving, saved, error, dirty, disabled: !dirty }}
    >
      <section className="tset-section">
        <h2 className="tset-section__title">Notifications</h2>
        <ToggleRow
          title="All notifications"
          hint="The master switch — turn everything off in one tap."
          checked={prefs.master}
          onChange={(master) => setPrefs((p) => ({ ...p, master }))}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">What you hear about</h2>
        {NOTIFICATION_CATEGORY_META.map((c) => (
          <ToggleRow
            key={c.key}
            title={c.label}
            hint={`${TEACHER_HINTS[c.key] || c.hint}${c.critical ? ' Critical notices always show in-app.' : ''}`}
            checked={prefs.categories[c.key]}
            onChange={setCategory(c.key)}
            disabled={!prefs.master}
          />
        ))}
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Channels</h2>
        <ToggleRow
          title="Push notifications"
          hint={
            !isPushSupported()
              ? 'Not supported in this browser.'
              : pushState === 'denied'
                ? 'Blocked in your browser settings — allow notifications for zedexams.com to enable.'
                : 'Delivered to this device even when ZedExams is closed.'
          }
          checked={prefs.channels.push}
          onChange={onTogglePush}
          disabled={!prefs.master || !isPushSupported() || pushState === 'denied'}
        />
        <ToggleRow
          title="In-app notifications"
          hint="Shown in the bell menu while you're using ZedExams."
          checked={prefs.channels.inApp}
          onChange={(inApp) => setPrefs((p) => ({ ...p, channels: { ...p.channels, inApp } }))}
          disabled={!prefs.master}
        />
      </section>

      <section className="tset-section">
        <h2 className="tset-section__title">Quiet hours</h2>
        <ToggleRow
          title="Enable quiet hours"
          hint="No pushes during these hours — they wait quietly in-app."
          checked={prefs.quietHours.enabled}
          onChange={(enabled) =>
            setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, enabled } }))
          }
          disabled={!prefs.master}
        />
        {prefs.quietHours.enabled && (
          <div className="tset-grid" style={{ marginTop: 10 }}>
            <div className="tset-field">
              <label className="studio-label" htmlFor="nt-qh-start">From</label>
              <input
                id="nt-qh-start"
                className="studio-input"
                type="time"
                value={prefs.quietHours.start}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, start: e.target.value } }))
                }
              />
            </div>
            <div className="tset-field">
              <label className="studio-label" htmlFor="nt-qh-end">Until</label>
              <input
                id="nt-qh-end"
                className="studio-input"
                type="time"
                value={prefs.quietHours.end}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, quietHours: { ...p.quietHours, end: e.target.value } }))
                }
              />
            </div>
          </div>
        )}
      </section>
    </SettingsDetailShell>
  )
}
