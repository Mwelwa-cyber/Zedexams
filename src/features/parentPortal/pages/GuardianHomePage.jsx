/**
 * GuardianHomePage — /for-guardians
 *
 * What is left of the parent area: the children a guardian has approved, and
 * the one thing they can still do about each — withdraw their consent. It is
 * deliberately small. Results reach a parent over WhatsApp and payment is a
 * link, so this page exists for the right a guardian keeps, not to bring a
 * dashboard back.
 *
 * It reads the guardian's own `parentLinks` straight from Firestore (the rule
 * allows exactly that), and withdrawing goes through `withdrawGuardianConsent`,
 * which acts only on the caller's own link. Withdrawing is confirmed in-line
 * and the result is stated honestly: if another guardian's approval still
 * stands the child is NOT limited, and the page says so.
 */
import { useCallback, useEffect, useState } from 'react'
import '../../../shared/styles/learnerTheme.css'
import '../styles/parentApp.css'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { reportClientError } from '../../../utils/clientErrorReporting'
import { listMyLinks, withdrawGuardianConsent } from '../services/guardianActions'
import {
  CHILDLINE, canWithdraw, linkState, linkStateLabel, withdrawalMessage,
} from '../lib/guardianActionsView'

export default function GuardianHomePage() {
  const { currentUser, logout } = useAuth()
  const uid = currentUser?.uid
  const [state, setState] = useState({ loading: true, links: [], error: null })
  const [confirmingId, setConfirmingId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const links = await listMyLinks(uid)
      setState({ loading: false, links, error: null })
    } catch (err) {
      reportClientError(err, 'guardianHome.load')
      setState({ loading: false, links: [], error: 'We could not load your children just now.' })
    }
  }, [uid])

  useEffect(() => { load() }, [load])

  async function withdraw(link) {
    setBusyId(link.id)
    setActionError('')
    try {
      const res = await withdrawGuardianConsent(link.childUid)
      setNotice(withdrawalMessage({
        childName: link.childName,
        childStillApproved: Boolean(res?.childStillApproved),
      }))
      setConfirmingId(null)
      await load()
    } catch (err) {
      reportClientError(err, 'guardianHome.withdraw')
      setActionError(err?.message || 'That did not go through. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const { loading, links, error } = state

  return (
    <div className="lhx pax">
      <div className="lhx-page">
        <SeoHelmet title="Guardian · ZedExams" noIndex />
        <div className="pax-top">
          <img className="pax-brand" src="/zedexams-logo.webp" alt="ZedExams" />
          <span className="pax-role-pill">Guardian</span>
        </div>

        <h1 className="pax-greet">Children you look after</h1>
        <p className="pax-greet-sub">
          You no longer need an account to follow your child&rsquo;s results or pay for a plan.
          This is where you can withdraw your consent if you want to.
        </p>

        {notice && (
          <div className="lhx-card" style={{ padding: 14, marginBottom: 14 }} role="status">
            <p className="lhx-set-desc" style={{ margin: 0, lineHeight: 1.5 }}>{notice}</p>
          </div>
        )}
        {actionError && <p className="lhx-set-desc" role="alert" style={{ margin: '0 0 10px' }}>{actionError}</p>}

        {loading ? (
          <div className="lhx-card" style={{ padding: 18 }} aria-busy="true">Loading…</div>
        ) : error ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-desc" role="alert" style={{ margin: '0 0 12px' }}>{error}</p>
            <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={load}>Try again</button>
          </div>
        ) : links.length === 0 ? (
          <div className="lhx-card" style={{ padding: 18 }}>
            <p className="lhx-set-title">No children are linked to this account</p>
            <p className="lhx-set-desc" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
              If you expected to see someone here, check you signed in with the email address you
              gave when you approved.
            </p>
          </div>
        ) : (
          links.map((link) => {
            const st = linkState(link.raw)
            return (
              <div key={link.id} className="lhx-card" style={{ padding: 16, marginBottom: 12 }}>
                <p className="lhx-set-title">{link.childName || 'Your child'}</p>
                <p className="lhx-set-desc" style={{ margin: '4px 0 10px' }}>
                  {link.grade ? `Grade ${link.grade} · ` : ''}{linkStateLabel(st)}
                </p>
                {canWithdraw(st) && (
                  confirmingId === link.id ? (
                    <>
                      <p className="lhx-set-desc" style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
                        They keep their lessons and past papers. The leaderboard and purchases pause
                        until a guardian approves again.
                      </p>
                      <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" disabled={busyId === link.id} onClick={() => withdraw(link)}>
                        Yes, withdraw my consent
                      </button>
                      <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" style={{ marginTop: 8 }} disabled={busyId === link.id} onClick={() => setConfirmingId(null)}>
                        Go back
                      </button>
                    </>
                  ) : (
                    <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" onClick={() => { setConfirmingId(link.id); setNotice(''); setActionError('') }}>
                      Withdraw my consent
                    </button>
                  )
                )}
              </div>
            )
          })
        )}

        <p className="pax-note" style={{ marginTop: 16 }}>
          If a child is in danger, {CHILDLINE.name} is {CHILDLINE.number}, free from any network.
        </p>
        <button type="button" className="lhx-btn lhx-btn-soft lhx-btn-block" style={{ marginTop: 12 }} onClick={() => logout()}>
          Sign out
        </button>
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}
