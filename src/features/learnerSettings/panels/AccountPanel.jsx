// Account body — account overview, invoices/payments, data export, delete
// account. The subscription plan cards moved to PremiumPanel; this body is the
// account-management half composed into MyAccountPanel. Real wiring throughout:
// subscription tier from useSubscription, data export builds a JSON blob from
// the live profile, delete runs the real deleteMyAccount cloud path.

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { useSubscription } from '../../../hooks/useSubscription'
import { deleteMyAccount } from '../../../utils/accountService'
import InvoicesCard from '../../../components/dashboard/InvoicesCard'
import PaymentHistoryCard from '../../../components/dashboard/PaymentHistoryCard'
import { Panel, Section, Btn, Note, Field, TextInput } from '../components/ui'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Build + download a JSON copy of the learner's data. Exported so the Progress
// card can reuse the exact same "Download progress report" mechanism.
export function downloadMyData(currentUser, userProfile, pushToast) {
  try {
    const payload = {
      exportedAt: new Date().toISOString(),
      account: { email: currentUser?.email, uid: currentUser?.uid },
      profile: userProfile || {},
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zedexams-my-data-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    pushToast?.('success', 'Your data download has started.')
  } catch {
    pushToast?.('error', 'Could not prepare your data. Please try again.')
  }
}

// Headerless account-management body — composed by MyAccountPanel.
export function AccountBody({ pushToast }) {
  const { userProfile, currentUser } = useAuth()
  const { tierLabel, isPremium } = useSubscription()
  const navigate = useNavigate()

  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Rough storage figure from the one learner-controlled blob we store.
  const storageKb = useMemo(() => {
    const photo = userProfile?.avatarPhotoUrl || ''
    return Math.max(1, Math.round((photo.length * 0.75) / 1024))
  }, [userProfile?.avatarPhotoUrl])

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE'
  const handleDelete = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    try {
      await deleteMyAccount()
      pushToast?.('success', 'Your account and data have been permanently deleted.')
      navigate('/', { replace: true })
    } catch {
      pushToast?.('error', 'We could not delete your account. Please try again or contact support.')
      setDeleting(false)
    }
  }

  return (
    <>
      {/* Account overview */}
      <Section title="Account" hint="Details tied to your ZedExams account.">
        <div className="lset-grid">
          <Field label="Login email" htmlFor="lset-acct-email">
            <TextInput id="lset-acct-email" value={currentUser?.email ?? ''} disabled />
          </Field>
          <Field label="Plan"><TextInput value={isPremium ? tierLabel : 'Free'} disabled /></Field>
          <Field label="Member since"><TextInput value={fmtDate(userProfile?.createdAt)} disabled /></Field>
          <Field label="Storage used" hint="Your avatar and saved items"><TextInput value={`${storageKb} KB`} disabled /></Field>
        </div>
      </Section>

      <InvoicesCard />
      <PaymentHistoryCard />

      {/* Data & privacy */}
      <Section title="Your data" hint="Download a copy of your information or review your privacy choices.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Btn variant="ghost" onClick={() => downloadMyData(currentUser, userProfile, pushToast)}>⬇ Download my data</Btn>
          <Btn variant="ghost" onClick={() => navigate('/settings?section=security')}>Privacy settings</Btn>
        </div>
      </Section>

      {/* Danger zone */}
      <Section title="Delete account" hint="Permanently delete your ZedExams account and personal data. This cannot be undone.">
        <Note tone="danger">
          Deleting removes your profile, results, saved content, class memberships and subscription records tied to{' '}
          <strong>{currentUser?.email || 'your account'}</strong>. You'll be signed out immediately.
        </Note>
        {!confirming ? (
          <div style={{ marginTop: 14 }}>
            <Btn variant="danger" onClick={() => setConfirming(true)}>Delete my account</Btn>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <Field label="Type DELETE to confirm" htmlFor="lset-del">
              <TextInput id="lset-del" value={confirmText} onChange={setConfirmText} placeholder="DELETE" disabled={deleting} />
            </Field>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <Btn variant="danger" onClick={handleDelete} disabled={!canDelete} loading={deleting}>Permanently delete</Btn>
              <Btn variant="ghost" onClick={() => { setConfirming(false); setConfirmText('') }} disabled={deleting}>Cancel</Btn>
            </div>
          </div>
        )}
      </Section>
    </>
  )
}

export default function AccountPanel({ section, pushToast }) {
  return (
    <Panel section={section}>
      <AccountBody pushToast={pushToast} />
    </Panel>
  )
}
