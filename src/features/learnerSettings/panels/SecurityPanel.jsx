// Password & Security panel — keeps the account safe with real, observable
// state. The strength meter is derived only from facts we can verify (a working
// password, recovery contact on file, verified email / 2FA intent) so it never
// lies. Recovery fields autosave through the SaveContext debounce; the one-off
// "send reset email" action carries its own local button state. Features that
// need backend we haven't built (device list, login history, remote sign-out)
// are presented honestly with a "Coming soon" pill rather than faked.

import { useEffect, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useSettingsSave } from '../components/SaveContext'
import { Panel, Section, Field, TextInput, Toggle, Btn, Note } from '../components/ui'
import { normalizeSecurityPrefs, computeSecurityStrength } from '../lib/learnerPrefs'
import { PasskeySection } from '../../auth'

function fmtDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const SEG_CLASS = { green: 'lset-meter__seg--green', amber: 'lset-meter__seg--amber', danger: 'lset-meter__seg--danger' }

const SOON_ROWS = [
  { key: 'devices', label: 'Active devices' },
  { key: 'history', label: 'Login history' },
  { key: 'signout-all', label: 'Log out of all devices' },
]

// Headerless body — composed by PrivacySecurityPanel; default keeps the Panel.
export function SecurityBody({ pushToast }) {
  const { userProfile, currentUser, resetPassword } = useAuth()
  const { commit } = useSettingsSave()

  const [recovery, setRecovery] = useState({ recoveryEmail: '', recoveryPhone: '' })
  const [sending, setSending] = useState(false)

  // Seed the free-text recovery fields once the profile arrives (keyed on uid so
  // our own autosaves flowing back through onSnapshot don't clobber typing).
  useEffect(() => {
    if (!userProfile) return
    const n = normalizeSecurityPrefs(userProfile?.learnerSettings?.security)
    setRecovery({ recoveryEmail: n.recoveryEmail, recoveryPhone: n.recoveryPhone })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, userProfile?.uid])

  const strength = computeSecurityStrength({
    security: userProfile?.learnerSettings?.security,
    emailVerified: currentUser?.emailVerified,
    hasPassword: true,
  })

  // Always re-read the current normalized object so a single-field write never
  // drops the other recovery field or the 2FA intent.
  const commitSecurity = (patch) => {
    const current = normalizeSecurityPrefs(userProfile?.learnerSettings?.security)
    commit({ 'learnerSettings.security': { ...current, ...patch } })
  }

  const setRecoveryField = (key, value) => {
    setRecovery((r) => ({ ...r, [key]: value }))
    commitSecurity({ [key]: value })
  }

  const sendReset = async () => {
    if (sending || !currentUser?.email) return
    setSending(true)
    try {
      await resetPassword(currentUser.email)
      pushToast?.('success', 'Password reset email sent. Check your inbox.')
    } catch {
      pushToast?.('error', 'Could not send the reset email. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Security strength */}
      <Section title="Security strength" hint="Based on your real account state — never a guess.">
        <div className="lset-meter" role="img" aria-label={`Security: ${strength.label}`}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`lset-meter__seg${i < strength.score ? ` ${SEG_CLASS[strength.tone]}` : ''}`}
            />
          ))}
        </div>
        <p className="lset-section__hint" style={{ marginTop: 10, fontWeight: 700 }}>
          {strength.emoji} {strength.label}
        </p>
        <p className="lset-section__hint" style={{ marginTop: 4 }}>
          {strength.score >= 3
            ? 'Your account is well protected. Keep your recovery details up to date.'
            : 'Add a recovery email or phone, verify your email and turn on two-factor to strengthen this.'}
        </p>
      </Section>

      {/* Password */}
      <Section title="Password" hint="Change your password securely by email.">
        <Btn onClick={sendReset} loading={sending} disabled={!currentUser?.email}>
          Send password reset email
        </Btn>
        <Note>
          For your safety, password changes are done through a secure link we email to{' '}
          <strong>{currentUser?.email || 'your account'}</strong> — we never show or change it here.
        </Note>
      </Section>

      {/* Passkeys (WebAuthn) — renders only while the platform flag is on. */}
      <PasskeySection />

      {/* Recovery */}
      <Section title="Account recovery" hint="Where we can reach you if you're ever locked out.">
        <div className="lset-grid">
          <Field label="Recovery email" hint="A second email, different from your login" htmlFor="lset-rec-email">
            <TextInput
              id="lset-rec-email"
              type="email"
              value={recovery.recoveryEmail}
              onChange={(v) => setRecoveryField('recoveryEmail', v)}
              placeholder="e.g. parent@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Recovery phone" hint="A mobile number we can text" htmlFor="lset-rec-phone">
            <TextInput
              id="lset-rec-phone"
              type="tel"
              value={recovery.recoveryPhone}
              onChange={(v) => setRecoveryField('recoveryPhone', v)}
              placeholder="e.g. +260 97 000 0000"
              autoComplete="tel"
            />
          </Field>
        </div>
      </Section>

      {/* Two-factor authentication */}
      <Section title="Two-factor authentication" hint="An extra step at sign-in for stronger protection.">
        <Toggle
          title="Enable two-factor authentication"
          hint="Record that you want 2FA on your account"
          checked={normalizeSecurityPrefs(userProfile?.learnerSettings?.security).twoFactorEnabled}
          onChange={(next) => commitSecurity({ twoFactorEnabled: next })}
        />
        <Note tone="accent">
          Full 2FA enrolment with an authenticator app is coming soon. Turning this on now records your
          intent so we can guide you through setup the moment it's ready.
        </Note>
      </Section>

      {/* Account activity */}
      <Section title="Account activity" hint="A window into how your account is being used.">
        <div className="lset-stats" style={{ marginBottom: 14 }}>
          <div className="lset-stat">
            <div className="lset-stat__value">{fmtDateTime(currentUser?.metadata?.lastSignInTime)}</div>
            <div className="lset-stat__label">Last login</div>
          </div>
          <div className="lset-stat">
            <div className="lset-stat__value">{fmtDateTime(currentUser?.metadata?.creationTime)}</div>
            <div className="lset-stat__label">Account created</div>
          </div>
        </div>
        {SOON_ROWS.map((row) => (
          <div
            key={row.key}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}
          >
            <span className="lset-toggle__title">{row.label}</span>
            <span className="lset-soon">Coming soon</span>
          </div>
        ))}
      </Section>
    </>
  )
}

export default function SecurityPanel({ section, pushToast }) {
  return (
    <Panel section={section}>
      <SecurityBody pushToast={pushToast} />
    </Panel>
  )
}
