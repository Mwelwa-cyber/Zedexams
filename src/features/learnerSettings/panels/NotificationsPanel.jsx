// Notifications panel — learner-friendly reminder channels + granular reminders.
//
// Everything persists under learnerSettings.notifications (normalized with
// normalizeReminderPrefs) so it syncs across devices via Firestore. The master
// Push channel also mirrors to the real notification centre: turning it on
// requests OS permission + registers an FCM token via src/services/notifications/fcm.js.

import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Toggle, Note } from '../components/ui'
import { normalizeReminderPrefs, REMINDER_GROUPS } from '../lib/learnerPrefs'
import { isPushSupported, pushPermission, requestPushPermission } from '../../../services/notifications/fcm'

export default function NotificationsPanel({ section, pushToast }) {
  const { userProfile, currentUser } = useAuth()
  const { commit } = useSettingsSave()

  const normalized = normalizeReminderPrefs(userProfile?.learnerSettings?.notifications)
  const pushSupported = isPushSupported()
  const permission = pushPermission()

  // Commit a whole normalized copy so no other key is ever dropped.
  const save = (mutate) => {
    const next = normalizeReminderPrefs(userProfile?.learnerSettings?.notifications)
    mutate(next)
    commit({ 'learnerSettings.notifications': next })
  }

  const setChannel = (key, value) => save((next) => { next.channels[key] = value })
  const setItem = (key, value) => save((next) => { next.items[key] = value })

  const onPushToggle = async (value) => {
    setChannel('push', value)
    if (!value) return
    try {
      const result = await requestPushPermission(currentUser?.uid)
      if (result === 'granted') {
        pushToast?.('success', 'Push notifications enabled on this device.')
        return
      }
      // Enabling didn't actually take (blocked, unsupported, or granted-but-no-
      // token) — flip the stored pref back off so it doesn't claim to be on when
      // the server has nowhere to deliver.
      setChannel('push', false)
      if (result === 'denied') {
        pushToast?.('error', 'Push permission was blocked. Enable it in your browser settings.')
      } else {
        // 'error' (granted but no token) / 'unsupported' — permission wasn't the
        // blocker, so don't tell the learner to change browser settings.
        pushToast?.('error', "Couldn't enable push on this device right now. Please try again later.")
      }
    } catch {
      setChannel('push', false)
      pushToast?.('error', "Couldn't enable push notifications right now.")
    }
  }

  return (
    <Panel section={section}>
      <Note tone="accent">Your notification choices sync across every device you sign in on.</Note>

      <Section title="Channels" hint="Where should we reach you?">
        <Toggle
          title="Push notifications"
          hint={
            !pushSupported ? 'Not available on this device.'
              : permission === 'denied' ? 'Blocked — allow notifications in your browser settings.'
                : 'Alerts on this device, even when the tab is closed.'
          }
          checked={normalized.channels.push}
          onChange={onPushToggle}
          disabled={!pushSupported}
        />
        {!pushSupported && (
          <Note>This device or browser doesn't support push notifications. Email still works.</Note>
        )}
        <Toggle
          title="Email"
          hint="A summary and reminders to your inbox."
          checked={normalized.channels.email}
          onChange={(v) => setChannel('email', v)}
        />
        <Toggle
          title="SMS"
          hint="optional — standard rates may apply"
          checked={normalized.channels.sms}
          onChange={(v) => setChannel('sms', v)}
        />
      </Section>

      {REMINDER_GROUPS.map((group) => (
        <Section key={group.id} title={group.label}>
          {group.items.map((item) => (
            <Toggle
              key={item.key}
              title={item.label}
              checked={normalized.items[item.key]}
              onChange={(v) => setItem(item.key, v)}
            />
          ))}
        </Section>
      ))}
    </Panel>
  )
}
