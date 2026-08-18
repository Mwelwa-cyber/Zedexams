/**
 * ParentAlerts — /family/account/alerts. The guardian's own alert
 * preferences, inside the family shell.
 *
 * ── What it replaces ────────────────────────────────────────────────
 *
 * The Account row used to link to `/settings?section=notifications`.
 * Three things were wrong with that, and only the first is cosmetic:
 *
 *   1. `/settings` renders the LEARNER shell for anyone who is not a
 *      teacher or an admin — the learner top nav, a character-avatar
 *      picker built for children, and the heading "Signed in as
 *      Learner." A guardian managing their own email preferences was
 *      being told, by the product, that they were signed in as a child.
 *   2. `ZedExamsSettings` coerced any unrecognised role to `learner`
 *      (`VALID_ROLES`), so "Learner" was not a display slip — the whole
 *      page was serving a learner's tab list to a parent.
 *   3. `?section=` was ignored entirely (see lib/settingsSection.js), so
 *      even that page opened on Profile rather than Notifications.
 *
 * ── Why the rows are the ones they are ──────────────────────────────
 *
 * Each row is a message a guardian actually receives. `assessments`,
 * `account` and `system` already exist and are what the senders use;
 * `guardianReports` was added for the Sunday family email, which until
 * now had no switch at all — /family/account promised "Turn it off in
 * Account → Alerts" and there was nothing behind the promise.
 *
 * Approval requests and safety notices are CRITICAL categories: they
 * always appear in the notification centre, and the toggle here governs
 * push only. That is stated on the row rather than left as a surprise —
 * a parent who switches "safety notices" off and still finds one in the
 * bell has been misled by their own settings screen.
 *
 * Writes go straight to the guardian's own profile through
 * `updateProfileFields`, the same path the learner and teacher screens
 * use. Nothing here touches a child's account; the child's permissions
 * are in Manage children, which is a different question with a different
 * audit trail.
 */

import { useMemo, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { normalizeNotificationPrefs } from '../../../engines/notification-engine/notificationPrefs'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { BackRow } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

/**
 * The rows, as data.
 *
 * `critical` marks a category the notification centre always shows
 * regardless of this switch — the switch gates push.
 *
 * `channels` names the delivery paths this row actually uses, and is
 * PRINTED on the row rather than kept as a comment. Only the weekly
 * report is emailed today; drawing "email and push" over the other three
 * would be the same shape of broken promise this page was built to fix,
 * and leaving it unsaid means a parent turning the email channel off
 * cannot tell which of these four it affects.
 */
const ROWS = [
  {
    key: 'guardianReports',
    icon: '📈',
    title: 'Weekly family report',
    desc: "How your child's week went — sent every Sunday.",
    channels: ['email', 'push'],
  },
  {
    key: 'assessments',
    icon: '📅',
    title: 'Exam reminders',
    desc: 'When an exam your child is preparing for is coming up.',
    channels: ['push'],
  },
  {
    key: 'account',
    icon: '✅',
    title: 'Approval requests',
    desc: 'When your child asks you to unlock or allow something.',
    channels: ['push'],
    critical: true,
  },
  {
    key: 'system',
    icon: '🛡️',
    title: 'Safety notices',
    desc: 'Anything we need to tell you about your child’s account.',
    channels: ['push'],
    critical: true,
  },
]

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

export default function ParentAlerts() {
  const { currentUser, userProfile, updateProfileFields } = useAuth()

  // Optimistic mirror: the switch moves at once and the write follows, so
  // a slow round-trip never reads as a dead control.
  const [pending, setPending] = useState(null)
  const [failed, setFailed] = useState(false)

  const stored = useMemo(
    () => normalizeNotificationPrefs(userProfile?.notificationPrefs),
    [userProfile?.notificationPrefs],
  )
  const prefs = pending || stored

  async function save(next) {
    setPending(next)
    setFailed(false)
    try {
      await updateProfileFields({ notificationPrefs: next })
    } catch (err) {
      reportClientError(err, 'parentApp.saveAlertPrefs')
      // Put the switch back. A control that stays where the parent left
      // it while the account says otherwise is how somebody believes they
      // opted out of an email that keeps arriving.
      setPending(null)
      setFailed(true)
    }
  }

  const setCategory = (key, on) => save({
    ...prefs,
    categories: { ...prefs.categories, [key]: on },
  })

  const setChannel = (key, on) => save({
    ...prefs,
    channels: { ...prefs.channels, [key]: on },
  })

  return (
    <>
      <SeoHelmet title="Alerts · ZedExams" noIndex />
      <BackRow
        title="Alerts you receive"
        subtitle="What we tell you about, and how"
        to="/family/account"
      />

      {failed && (
        <div className="lhx-error" role="alert">
          <p className="lhx-error-text">
            We could not save that just now. Check your connection and try again.
          </p>
        </div>
      )}

      <h2 className="lhx-set-head">How we reach you</h2>
      <div className="lhx-set-group">
        <div className="lhx-set-row">
          <span className="lhx-set-ic" aria-hidden="true">📧</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title" style={{ display: 'block' }}>Email</span>
            <span className="lhx-set-desc" style={{ display: 'block' }}>
              The weekly report goes to {currentUser?.email || userProfile?.email || 'your email address'}.
            </span>
          </span>
          <Switch
            label="Email"
            checked={prefs.channels.email !== false}
            onChange={(on) => setChannel('email', on)}
          />
        </div>
        <div className="lhx-set-row">
          <span className="lhx-set-ic" aria-hidden="true">📲</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title" style={{ display: 'block' }}>Push alerts</span>
            <span className="lhx-set-desc" style={{ display: 'block' }}>
              On this device, when something needs you.
            </span>
          </span>
          <Switch
            label="Push alerts"
            checked={prefs.channels.push !== false}
            onChange={(on) => setChannel('push', on)}
          />
        </div>
      </div>

      <h2 className="lhx-set-head">What we tell you about</h2>
      <div className="lhx-set-group">
        {ROWS.map((row) => (
          <div className="lhx-set-row" key={row.key}>
            <span className="lhx-set-ic" aria-hidden="true">{row.icon}</span>
            <span className="lhx-set-txt">
              <span className="lhx-set-title" style={{ display: 'block' }}>{row.title}</span>
              <span className="lhx-set-desc" style={{ display: 'block' }}>
                {row.desc}
                {row.critical && ' Always shows in your inbox; this turns off the push alert.'}
              </span>
              <span className="lhx-set-desc" style={{ display: 'block' }}>
                {row.channels.includes('email') ? 'Email and push' : 'Push only'}
              </span>
            </span>
            <Switch
              label={row.title}
              checked={prefs.categories[row.key] !== false}
              onChange={(on) => setCategory(row.key, on)}
            />
          </div>
        ))}
      </div>

      <p className="pax-note">
        Receipts and password changes are not on this list — those are sent
        because you asked for them, and we do not switch them off.
      </p>
      <div style={{ height: 20 }} />
    </>
  )
}
