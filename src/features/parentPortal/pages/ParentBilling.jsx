/**
 * ParentBilling — /family/account/billing. The guardian's own payments
 * and receipts, inside the family shell.
 *
 * The Account row used to point at `/my-subscription`, which renders
 * under the learner navbar and is written for the account that HOLDS the
 * subscription. A guardian holds none: their money credits the child
 * (`beneficiaryUid` — see ParentPlan), so that page could only ever tell
 * them they were on the free plan while their child was not.
 *
 * `invoices/{id}.userId` is the PAYER, with `beneficiaryUid` recorded
 * alongside, which is why this list works at all: the guardian reads
 * their own receipts under the existing rule (`resource.data.userId ==
 * request.auth.uid`) and each row can name the child it paid for.
 *
 * Storage-backed PDFs are resolved on demand rather than up front —
 * `resolveInvoicePdfUrl` is a signed-URL round trip per receipt, and a
 * guardian with a year of monthly payments would otherwise pay for
 * twelve of them to look at a list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { listInvoicesForUser, resolveInvoicePdfUrl } from '../../../utils/invoices'
import { reportClientError } from '../../../utils/clientErrorReporting'
import useGuardianChildren from '../hooks/useGuardianChildren'
import { firstNameOf } from '../lib/parentAppView'
import { BackRow, Empty, ErrorRetry, ListSkeleton } from '../components/ParentPrimitives'
import SeoHelmet from '../../../shared/components/SeoHelmet'

function toDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDate(value) {
  const d = toDate(value)
  if (!d) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatAmount(invoice) {
  const amount = Number(invoice?.amount)
  if (!Number.isFinite(amount)) return ''
  const currency = String(invoice?.currency || 'ZMW').toUpperCase()
  return currency === 'ZMW' ? `K${Math.round(amount)}` : `${currency} ${amount}`
}

export default function ParentBilling() {
  const { currentUser } = useAuth()
  const { children } = useGuardianChildren()
  const [state, setState] = useState({ loading: true, error: null, invoices: [] })
  const [opening, setOpening] = useState(null)

  const load = useCallback(async () => {
    if (!currentUser?.uid) return
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const invoices = await listInvoicesForUser(currentUser.uid)
      setState({ loading: false, error: null, invoices })
    } catch (err) {
      reportClientError(err, 'parentApp.listInvoices')
      setState({
        loading: false,
        error: err?.message || 'We could not load your receipts just now.',
        invoices: [],
      })
    }
  }, [currentUser?.uid])

  useEffect(() => { load() }, [load])

  // uid → first name, so a receipt says who it was for rather than
  // showing a uid the guardian has never seen.
  const nameFor = useMemo(() => {
    const map = new Map()
    for (const child of children) map.set(child.childUid, firstNameOf(child.displayName))
    return (uid) => (uid ? map.get(uid) || null : null)
  }, [children])

  async function openReceipt(invoice) {
    if (opening) return
    setOpening(invoice.id)
    try {
      const url = await resolveInvoicePdfUrl(invoice.pdfPath || invoice.storagePath)
      if (url) window.open(url, '_blank', 'noopener')
      else setState((s) => ({ ...s, error: 'That receipt is not available to download yet.' }))
    } finally {
      setOpening(null)
    }
  }

  return (
    <>
      <SeoHelmet title="Payments · ZedExams" noIndex />
      <BackRow
        title="Payments and receipts"
        subtitle="What you have paid, and for whom"
        to="/family/account"
      />

      {state.loading ? (
        <ListSkeleton rows={3} height={70} />
      ) : state.error ? (
        <ErrorRetry message={state.error} onRetry={load} />
      ) : state.invoices.length === 0 ? (
        <Empty icon="🧾" action={{ label: 'See plans', to: '/family/plan' }}>
          No payments yet. Anything you buy for a child shows up here with a
          receipt you can download.
        </Empty>
      ) : (
        <div className="lhx-set-group">
          {state.invoices.map((invoice) => {
            const forChild = nameFor(invoice.beneficiaryUid) || invoice.beneficiaryName
            return (
              <button
                type="button"
                key={invoice.id}
                className="lhx-set-row lhx-set-tap"
                onClick={() => openReceipt(invoice)}
                disabled={opening === invoice.id}
              >
                <span className="lhx-set-ic" aria-hidden="true">🧾</span>
                <span className="lhx-set-txt">
                  <span className="lhx-set-title" style={{ display: 'block' }}>
                    {formatAmount(invoice)}
                    {forChild ? ` · for ${forChild}` : ''}
                  </span>
                  <span className="lhx-set-desc" style={{ display: 'block' }}>
                    {[formatDate(invoice.issuedAt), invoice.planName || invoice.planId]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="lhx-set-chev" aria-hidden="true">
                  {opening === invoice.id ? '…' : '›'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="lhx-set-group" style={{ marginTop: 16 }}>
        <Link className="lhx-set-row lhx-set-tap" to="/family/plan">
          <span className="lhx-set-ic" aria-hidden="true">💳</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Plans</span>
            <span className="lhx-set-desc">What each plan costs and covers</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </Link>
      </div>

      <p className="pax-note">
        A ZedExams plan does not renew itself — you pay for the period you
        choose, and nothing is taken after it ends.
      </p>
      <div style={{ height: 20 }} />
    </>
  )
}
