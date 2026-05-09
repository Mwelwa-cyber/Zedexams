/**
 * "My invoices" panel on /profile (audit D3).
 *
 * Shows the most recent receipts the server has issued for this user.
 * Each row has a Download button that resolves a fresh signed URL —
 * no stale tokens cached client-side.
 *
 * Self-hides for users with no invoices yet (most users on free).
 */

import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { listInvoicesForUser, resolveInvoicePdfUrl } from '../../utils/invoices'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate?.() ?? new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtMoney(amount, currency) {
  if (typeof amount !== 'number') return '—'
  return `${currency || 'ZMW'} ${amount.toFixed(2)}`
}

function InvoiceRow({ invoice }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleDownload() {
    setBusy(true); setError('')
    try {
      const url = await resolveInvoicePdfUrl(invoice.storagePath)
      if (!url) { setError('Could not load this receipt.'); return }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      console.warn('[InvoiceRow] download failed', err)
      setError('Download failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex-shrink-0 w-9 h-9 rounded-lg theme-bg-subtle flex items-center justify-center text-base">
        <span aria-hidden="true">🧾</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="theme-text font-bold text-sm truncate">{invoice.planName || 'Subscription'}</p>
        <p className="theme-text-muted text-xs">
          {invoice.number} · {fmtDate(invoice.issuedAt)}
        </p>
        {error && (
          <p role="alert" className="text-xs font-bold text-rose-700 mt-0.5">{error}</p>
        )}
      </div>
      <p className="theme-text font-black text-sm tabular-nums whitespace-nowrap">
        {fmtMoney(invoice.amount, invoice.currency)}
      </p>
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        className="text-xs font-bold theme-accent-text hover:underline disabled:opacity-50"
      >
        {busy ? '…' : 'PDF'}
      </button>
    </li>
  )
}

export default function InvoicesCard() {
  const { currentUser } = useAuth()
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    let cancelled = false
    listInvoicesForUser(currentUser.uid, { limit: 24 })
      .then((rows) => { if (!cancelled) setInvoices(rows) })
      .catch((err) => console.warn('[InvoicesCard] load failed', err))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [currentUser])

  // Self-hide for users with no invoices — most learners on the free
  // tier never see this panel, which is fine.
  if (loading || invoices.length === 0) return null

  return (
    <section className="theme-card border theme-border rounded-radius-md p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="theme-text font-black text-sm flex items-center gap-2">
          <span aria-hidden="true">🧾</span>
          My invoices
        </p>
        <p className="theme-text-muted text-xs">{invoices.length} receipt{invoices.length === 1 ? '' : 's'}</p>
      </div>
      <ul className="divide-y divide-current/10">
        {invoices.map((inv) => <InvoiceRow key={inv.id} invoice={inv} />)}
      </ul>
    </section>
  )
}
